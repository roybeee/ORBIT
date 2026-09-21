/** Machine-only release verification. This never creates a user identity. */
export async function deploymentHealth(
  request: Request,
  configuredToken: unknown,
  build: string,
): Promise<Response> {
  const headers = {
    'Cache-Control': 'private, no-store',
    'Vary': 'Authorization, OAI-Sites-Authorization',
  };
  // Operators provision 32 random bytes as 64 lowercase hexadecimal characters.
  const provided = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (typeof configuredToken !== 'string' || !/^[0-9a-f]{64}$/.test(configuredToken) || !provided) {
    return Response.json({error: 'Unauthorized'}, {status: 401, headers});
  }
  // Compare equal-length digests without an early exit; available in Workers.
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(value),
  ));
  const [expected, actual] = await Promise.all([digest(configuredToken), digest(provided)]);
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected[index] ^ actual[index];
  if (difference !== 0) return Response.json({error: 'Unauthorized'}, {status: 401, headers});
  if (!/^[\w.:-]{1,100}$/.test(build)) {
    return Response.json({error: 'Build unavailable'}, {status: 503, headers});
  }
  return Response.json({status: 'ok', build}, {headers});
}
