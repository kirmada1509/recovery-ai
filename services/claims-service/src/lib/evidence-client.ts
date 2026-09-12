export interface EvidenceDocument {
  id: string;
  documentType: string;
  uploadStatus: string;
}

/**
 * Confirms a document exists, belongs to the caller, and is ready — by
 * calling evidence-service's own API with the caller's access token, never
 * by reading evidence-service's database (CLAUDE.md invariant 2).
 */
export async function fetchOwnedReadyDocument(
  evidenceServiceUrl: string,
  documentId: string,
  callerAuthorizationHeader: string,
): Promise<EvidenceDocument | null> {
  const response = await fetch(new URL(`/v1/documents/${documentId}`, evidenceServiceUrl), {
    headers: { authorization: callerAuthorizationHeader },
  });
  if (!response.ok) return null;

  const body = (await response.json()) as { document: EvidenceDocument };
  if (body.document.uploadStatus !== 'ready') return null;
  return body.document;
}
