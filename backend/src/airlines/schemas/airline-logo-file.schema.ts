import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * FLT-01 / GEN-08: the uploaded logo image of an airline (one per airline), kept in the shared
 * database like hotel photos so every teammate's backend serves the same file. Max 5 MB.
 */
@Schema({ collection: 'airlinelogos', timestamps: { createdAt: true, updatedAt: false } })
export class AirlineLogoFile {
  @Prop({ required: true, unique: true })
  fileName: string;

  @Prop({ type: Types.ObjectId, ref: 'Airline', required: true, index: true })
  airline: Types.ObjectId;

  @Prop({ required: true })
  contentType: string;

  @Prop({ required: true })
  size: number;

  @Prop({ type: Buffer, required: true })
  data: Buffer;
}

export const AirlineLogoFileSchema = SchemaFactory.createForClass(AirlineLogoFile);
