export type StoreDiagnosticBucket<T> = {
  pendingIssueDetails: T[];
};

export function appendOverviewDiagnostic<T>(args: {
  bucketsByStoreId: Map<string, StoreDiagnosticBucket<T>>;
  operationalStoreIds: ReadonlySet<string>;
  storeId: string | null | undefined;
  diagnostic: T;
}) {
  const normalizedStoreId = String(args.storeId || "").trim();
  if (!normalizedStoreId || !args.operationalStoreIds.has(normalizedStoreId)) return false;

  const bucket = args.bucketsByStoreId.get(normalizedStoreId);
  if (!bucket) return false;

  bucket.pendingIssueDetails.push(args.diagnostic);
  return true;
}
