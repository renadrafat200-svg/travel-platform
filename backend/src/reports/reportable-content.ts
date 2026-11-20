/**
 * The kinds of content users can report, and the MongoDB collection each one lives in.
 *
 * TEAM RULE (Members 5 and 7): name your Mongoose models Post, Comment, Review and Itinerary
 * (Mongoose stores them in the collections below), and add this field to each schema:
 *     @Prop({ default: false, index: true }) isHidden: boolean;
 * Public lists and pages must skip documents where isHidden is true.
 */
export enum ReportTargetType {
  POST = 'post',
  COMMENT = 'comment',
  REVIEW = 'review',
  ITINERARY = 'itinerary',
}

export const CONTENT_COLLECTIONS: Record<ReportTargetType, string> = {
  [ReportTargetType.POST]: 'posts',
  [ReportTargetType.COMMENT]: 'comments',
  [ReportTargetType.REVIEW]: 'reviews',
  [ReportTargetType.ITINERARY]: 'itineraries',
};