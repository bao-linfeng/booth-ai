export interface CurrentUser {
  id: string
  externalUserId: string
  accountType: 'client' | 'admin'
  username: string
  nickname: string | null
  email: string | null
  mobile: string | null
  avatarPath: string | null
  company: string | null
  country: string | null
  city: string | null
  languageCode: string | null
  enabled: boolean
  roles: string[]
  permissions: string[]
  lastSyncedAt: string
}

export interface LoginResult {
  accessToken: string
  expiresAt: number
  user: CurrentUser
}
