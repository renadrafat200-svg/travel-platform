import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { ExchangeRate } from './schemas/exchange-rate.schema';

/** All rates are stored against this currency and converted through it */
export const RATES_BASE = 'USD';
const FXRATES_URL = 'https://api.fxratesapi.com/latest';
const FETCH_TIMEOUT_MS = 10_000;
/** After a failed call, wait this long before calling the API again */
const RETRY_AFTER_MS = 60 * 60 * 1000;

export interface RateSnapshot {
  base: string;
  /** Date of the rates, "YYYY-MM-DD" (shown to the user, ITN-18) */
  date: string;
  rates: Record<string, number>;
  fetchedAt: Date;
}

/**
 * ITN-18: exchange rates from FXRatesAPI, fetched once per day and cached in MongoDB.
 * - at startup, if today's rates are missing
 * - every day at midnight (@Cron)
 * If the API is down or the key is wrong, the last cached rates are used.
 * Only itinerary budgets are converted; booking prices stay in the platform currency (PAY-04).
 */
@Injectable()
export class ExchangeRatesService implements OnApplicationBootstrap {
  private readonly logger = new Logger('ExchangeRates');
  private latest: RateSnapshot | null = null;
  private lastFailedAt = 0;
  private refreshing: Promise<RateSnapshot> | null = null;

  constructor(
    @InjectModel(ExchangeRate.name)
    private readonly rateModel: Model<ExchangeRate>,
    private readonly config: ConfigService,
    private readonly reference: ReferenceDataService,
  ) {}

  /** Fetch on startup only if today's rates are not cached yet (does not delay startup) */
  onApplicationBootstrap() {
    void this.loadLatest().then((cached) => {
      if (cached?.date !== today()) {
        this.refresh().catch(() => undefined);
      }
    });
  }

  /** Once per day */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async dailyRefresh() {
    this.lastFailedAt = 0;
    await this.refresh().catch(() => undefined);
  }

  /**
   * Calls FXRatesAPI and caches the result. Parallel calls share one request.
   * Throws 503 when the API cannot be reached (callers fall back to the cached rates).
   */
  refresh(): Promise<RateSnapshot> {
    this.refreshing ??= this.fetchAndStore().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /**
   * The rates to convert with: the most recent cached day. If nothing has ever been cached,
   * one call to the API is tried; if that fails too, 503.
   */
  async getRates(): Promise<RateSnapshot> {
    const cached = this.latest ?? (await this.loadLatest());
    if (cached) {
      // A server that slept through midnight catches up, without making the request wait
      if (cached.date < today() && this.mayRetry()) {
        this.refresh().catch(() => undefined);
      }
      return cached;
    }
    if (this.mayRetry()) {
      try {
        return await this.refresh();
      } catch {
        // fall through to the 503 below
      }
    }
    throw new ServiceUnavailableException(
      'Exchange rates are not available yet: FXRatesAPI could not be reached and no rates are cached. Try again later.',
    );
  }

  /** Like getRates() but returns null instead of 503 (for optional totals) */
  async tryGetRates(): Promise<RateSnapshot | null> {
    try {
      return await this.getRates();
    } catch {
      return null;
    }
  }

  /** amount in `from` -> amount in `to`, through the base currency, rounded to cents */
  convert(amount: number, from: string, to: string, snapshot: RateSnapshot): number {
    if (from === to) return round2(amount);
    const rateFrom = from === snapshot.base ? 1 : snapshot.rates[from];
    const rateTo = to === snapshot.base ? 1 : snapshot.rates[to];
    if (!rateFrom || !rateTo) {
      const missing = !rateFrom ? from : to;
      throw new ServiceUnavailableException(
        `No exchange rate for ${missing} in the rates of ${snapshot.date}. Try again later.`,
      );
    }
    return round2((amount / rateFrom) * rateTo);
  }

  /** 400 for a malformed or unsupported currency code (ITN-18) */
  async assertSupported(code: string): Promise<string> {
    const upper = code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(upper)) {
      throw new BadRequestException(
        `${code} is not a currency code. Use a 3-letter code from GET /api/currencies`,
      );
    }
    if (!(await this.reference.isSupportedCurrency(upper))) {
      throw new BadRequestException(
        `Unsupported currency ${upper}. See GET /api/currencies`,
      );
    }
    return upper;
  }

  /** GET /api/exchange-rates: the cached rates of the supported currencies */
  async view() {
    const snapshot = await this.getRates();
    const supported = await this.reference.supportedCurrencies();
    return {
      base: snapshot.base,
      date: snapshot.date,
      fetchedAt: snapshot.fetchedAt,
      isToday: snapshot.date === today(),
      rates: Object.fromEntries(
        supported.map((c) => [c, c === snapshot.base ? 1 : (snapshot.rates[c] ?? null)]),
      ),
    };
  }

  // ---------------------------------------------------------------------------------------

  private mayRetry() {
    return Date.now() - this.lastFailedAt > RETRY_AFTER_MS;
  }

  private async loadLatest(): Promise<RateSnapshot | null> {
    const doc = await this.rateModel
      .findOne({ base: RATES_BASE })
      .sort({ date: -1 })
      .lean()
      .exec();
    if (doc) this.latest = toSnapshot(doc);
    return this.latest;
  }

  private async fetchAndStore(): Promise<RateSnapshot> {
    const url = new URL(this.config.get<string>('FXRATES_API_URL') || FXRATES_URL);
    url.searchParams.set('base', RATES_BASE);
    const key = this.config.get<string>('FXRATES_API_KEY');
    if (key) url.searchParams.set('api_key', key);

    let body: { success?: boolean; date?: string; base?: string; rates?: Record<string, unknown>; description?: string };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      body = (await res.json()) as typeof body;
      if (!res.ok || body.success === false) {
        throw new Error(body.description ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      this.lastFailedAt = Date.now();
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`FXRatesAPI unavailable (${reason}); using the last cached rates`);
      throw new ServiceUnavailableException(
        `FXRatesAPI could not be reached (${reason}). The last cached rates are still used.`,
      );
    }

    // Keep only proper positive numbers
    const rates = Object.fromEntries(
      Object.entries(body.rates ?? {}).filter(
        ([code, v]) => /^[A-Z]{3}$/.test(code) && typeof v === 'number' && v > 0,
      ),
    ) as Record<string, number>;
    if (!Object.keys(rates).length) {
      this.lastFailedAt = Date.now();
      throw new ServiceUnavailableException('FXRatesAPI returned no rates');
    }
    const date = /^\d{4}-\d{2}-\d{2}/.test(body.date ?? '') ? body.date!.slice(0, 10) : today();
    const doc = await this.rateModel
      .findOneAndUpdate(
        { base: RATES_BASE, date },
        { $set: { rates, fetchedAt: new Date() } },
        { upsert: true, returnDocument: 'after' },
      )
      .lean()
      .exec();
    this.latest = toSnapshot(doc!);
    this.lastFailedAt = 0;
    this.logger.log(`Exchange rates of ${date} cached (${Object.keys(rates).length} currencies)`);
    return this.latest;
  }
}

function toSnapshot(doc: ExchangeRate): RateSnapshot {
  return { base: doc.base, date: doc.date, rates: doc.rates, fetchedAt: doc.fetchedAt };
}

const today = () => new Date().toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
