// A very small Firestore client for the reminder Worker.
//
// The Worker needs to read every user's reminder settings, which no browser
// is allowed to do, so it authenticates as a service account: a JWT it signs
// itself, exchanged for an access token, then plain REST calls.
//
// Everything here uses WebCrypto and the fetch API rather than anything from
// Node, so the identical file runs on Workers and under tsx in the test
// suite. The private key only ever arrives as a Worker secret — nothing here
// reads a file from the repo, and nothing logs a credential.

const SCOPE = "https://www.googleapis.com/auth/datastore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

function b64urlFromBytes(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlFromText(text: string): string {
  return b64urlFromBytes(new TextEncoder().encode(text).buffer as ArrayBuffer);
}

/** PEM is base64 wrapped in header lines; WebCrypto wants the raw DER. */
function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    // Secrets pasted through a form often arrive with literal \n.
    .replace(/\\n/g, "\n")
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Exchanges a self-signed assertion for an access token good for an hour. */
export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlFromText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlFromText(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`)
  );
  const assertion = `${header}.${claims}.${b64urlFromBytes(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Token request failed (${res.status}). Check FIREBASE_SERVICE_ACCOUNT.`
    );
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

// ---------- values ----------
// Firestore's REST shape wraps every value in a type tag. These convert in
// each direction; integers come back as strings, which is the one that bites
// you if you forget.

type RestValue = Record<string, unknown>;

export function decodeValue(v: RestValue | undefined): unknown {
  if (!v) return undefined;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return Date.parse(String(v.timestampValue));
  if ("arrayValue" in v) {
    const arr = (v.arrayValue as { values?: RestValue[] }).values ?? [];
    return arr.map(decodeValue);
  }
  if ("mapValue" in v) {
    return decodeFields((v.mapValue as { fields?: Record<string, RestValue> }).fields);
  }
  return undefined;
}

export function decodeFields(
  fields: Record<string, RestValue> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = decodeValue(v);
  return out;
}

export function encodeValue(value: unknown): RestValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
}

export function encodeFields(obj: Record<string, unknown>): Record<string, RestValue> {
  const out: Record<string, RestValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = encodeValue(v);
  }
  return out;
}

// ---------- documents ----------

export interface RestDoc {
  /** the last path segment, i.e. the document id */
  id: string;
  fields: Record<string, unknown>;
}

export class Firestore {
  /** Every request the run has made, so it can stay inside the Worker's budget. */
  requests = 0;

  constructor(
    private token: string,
    private projectId: string
  ) {}

  private base(): string {
    return `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents`;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      "content-type": "application/json",
    };
  }

  /** Every document in a collection, following pagination. */
  async list(collection: string): Promise<RestDoc[]> {
    const out: RestDoc[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${this.base()}/${collection}`);
      url.searchParams.set("pageSize", "300");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      this.requests++;
      const res = await fetch(url.toString(), { headers: this.headers() });
      if (!res.ok) throw new Error(`List ${collection} failed (${res.status})`);
      const body = (await res.json()) as {
        documents?: { name: string; fields?: Record<string, RestValue> }[];
        nextPageToken?: string;
      };
      for (const d of body.documents ?? []) {
        out.push({ id: d.name.split("/").pop() ?? "", fields: decodeFields(d.fields) });
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** One document, or null when it doesn't exist. */
  async get(path: string): Promise<Record<string, unknown> | null> {
    this.requests++;
    const res = await fetch(`${this.base()}/${path}`, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Get ${path} failed (${res.status})`);
    const body = (await res.json()) as { fields?: Record<string, RestValue> };
    return decodeFields(body.fields);
  }

  /**
   * Writes only the named fields. A field in the mask but absent from the
   * body is deleted — which is how the test-email request gets cleared.
   */
  async patch(
    path: string,
    fields: Record<string, unknown>,
    mask: string[]
  ): Promise<void> {
    const url = new URL(`${this.base()}/${path}`);
    for (const f of mask) url.searchParams.append("updateMask.fieldPaths", f);
    this.requests++;
    const res = await fetch(url.toString(), {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ fields: encodeFields(fields) }),
    });
    if (!res.ok) {
      throw new Error(`Patch ${path} failed (${res.status}): ${await res.text()}`);
    }
  }
}

export function parseServiceAccount(json: string): ServiceAccount {
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(json) as ServiceAccount;
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON.");
  }
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is missing client_email, private_key or project_id."
    );
  }
  return sa;
}

export async function connect(saJson: string): Promise<Firestore> {
  const sa = parseServiceAccount(saJson);
  return new Firestore(await getAccessToken(sa), sa.project_id);
}
