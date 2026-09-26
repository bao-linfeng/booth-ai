export interface RoleEntityPermission {
  id: number
  entityValue: number
  permissionValue: number
  roleId: number | null
  entity: string
  permission: string
}

export interface Role {
  id: number
  name: string
  roleEntityPermissions: RoleEntityPermission[]
}

export interface UserAvatar {
  id: number
  fkUserId: number
  path: string
  filename: string
  originFilename: string
  fileSize: number
  suffix: string
  downloadCount: number
  createdAt: string
  userShortDto: null
}

export interface UserDetail {
  id: number
  username: string
  nickname: string
  firstname: string
  lastname: string
  email: string
  mobile: string
  fkAvatarId: number
  notes: string
  status: string
  fkLanguageCode: string
  company: string
  website: string
  country: string
  countryDictKey: string
  salesRegionId: number
  purchaseDiscountRate: number
  rentalDiscountRate: number
  city: string
  address: string
  zipcode: string
  createdAt: string
  updatedAt: string
  companyTaxId: string | null
  roles: Role[]
  avatar: UserAvatar | null
  isVip: boolean
  enabled: boolean
}

/** 登录接口 data 结构 */
export interface LoginData {
  data: {
    id: number
    username: string
    email: string
    roles: Role[]
    authorities: string[]
  }
  JWT: string
}
