export type UserRole = 'admin' | 'encargado' | 'domiciliario';

export interface User {
  id: string;
  org_id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  last_login: string | null;
  created_at: string;
}

export interface AuthPayload {
  userId: string;
  orgId: string;
  role: UserRole;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}
