export interface CollectionSnapshot<T> {
  data: T[];
  fromCache: boolean;
  hasPendingWrites: boolean;
}
