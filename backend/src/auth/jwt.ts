import { SignJWT, jwtVerify } from 'jose';

export interface TokenClaims { sub: string; username: string; }

export async function signToken(claims: TokenClaims, secret: string, expiresIn: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return await new SignJWT({ username: claims.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export async function verifyToken(token: string, secret: string): Promise<TokenClaims> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);
  if (typeof payload.sub !== 'string' || typeof payload.username !== 'string') {
    throw new Error('invalid claims');
  }
  return { sub: payload.sub, username: payload.username };
}
