import type { OAuthClientMetadata, OAuthClientProvider, StoredOAuthClientInformation, StoredOAuthTokens } from '@modelcontextprotocol/client'
import { auth } from '@modelcontextprotocol/client'

/**
 * Client OAuth de test : le VRAI parcours du SDK client (découverte, enregistrement dynamique, PKCE,
 * échange du code), la page de connexion remplie par un POST au lieu d'un navigateur.
 */
export class TestOAuthProvider implements OAuthClientProvider {
  info?: StoredOAuthClientInformation
  saved?: StoredOAuthTokens
  verifier = ''
  code: string | null = null
  iss: string | undefined
  constructor(private readonly login: { username: string; password: string }) {}
  get redirectUrl() { return 'http://127.0.0.1:1/callback' }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: 'Test', redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }
  }
  clientInformation() { return this.info }
  saveClientInformation(info: StoredOAuthClientInformation) { this.info = info }
  tokens() { return this.saved }
  saveTokens(tokens: StoredOAuthTokens) { this.saved = tokens }
  saveCodeVerifier(v: string) { this.verifier = v }
  codeVerifier() { return this.verifier }
  async redirectToAuthorization(url: URL) {
    const form = new URLSearchParams(url.searchParams)
    form.set('username', this.login.username)
    form.set('password', this.login.password)
    const res = await fetch(new URL('/oauth/authorize', url), { method: 'POST', body: form, redirect: 'manual' })
    if (res.status !== 302) return
    const back = new URL(res.headers.get('location')!)
    this.code = back.searchParams.get('code')
    this.iss = back.searchParams.get('iss') ?? undefined
  }
}

/** Se connecte et rend le fournisseur porteur des jetons ; `null` si la connexion est refusée. */
export async function signIn(serverUrl: URL, login: { username: string; password: string }): Promise<TestOAuthProvider | null> {
  const provider = new TestOAuthProvider(login)
  if (await auth(provider, { serverUrl }) !== 'REDIRECT') throw new Error('expected a redirect')
  if (!provider.code) return null
  await auth(provider, { serverUrl, authorizationCode: provider.code, ...(provider.iss ? { iss: provider.iss } : {}) })
  return provider
}
