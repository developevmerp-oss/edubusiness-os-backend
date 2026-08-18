export interface TenantInfo {
    id: string;
    name: string;
    subdomain: string;
    branding: {
        primaryColor: string;
        secondaryColor: string;
        themeMode: 'light' | 'dark';
    };
}

export interface UserPayload {
    id: string;
    tenant_id: string;
    email: string;
    role: 'super_admin' | 'admin' | 'teacher' | 'student' | 'parent';
    first_name: string;
    last_name: string;
}

declare global {
    namespace Express {
        interface Request {
            tenant?: TenantInfo;
            user?: UserPayload;
            csrfToken?: string;
        }
    }
}
