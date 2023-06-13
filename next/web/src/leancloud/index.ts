import * as LC from 'open-leancloud-storage/core';
import { authModule } from 'open-leancloud-storage/auth';
import { cloudModule } from 'open-leancloud-storage/cloud';
import { storageModule } from 'open-leancloud-storage/storage';
import axios, { AxiosError } from 'axios';
import { useQuery } from 'react-query';
import { atom, selector, useRecoilValue, useSetRecoilState } from 'recoil';
import { mergeWith } from 'lodash-es';

LC.use(authModule);
LC.use(cloudModule);
LC.use(storageModule);

export const ENABLE_LEANCLOUD_INTEGRATION = import.meta.env.VITE_ENABLE_LEANCLOUD_INTEGRATION;

const { VITE_LC_APP_ID, VITE_LC_APP_KEY, VITE_LEANCLOUD_API_HOST } = import.meta.env;

export const app = LC.init({
  appId: VITE_LC_APP_ID,
  appKey: VITE_LC_APP_KEY,
  serverURL: VITE_LEANCLOUD_API_HOST,
});

export const auth = app.auth();

export const db = app.database();

export const cloud = app.cloud();

export const storage = app.storage();

export const http = axios.create();
http.interceptors.request.use((config) => ({
  ...config,
  headers: {
    ...config.headers,
    'X-LC-Session': auth.currentUser?.sessionToken,
  },
}));

interface APIError {
  message: string;
}

http.interceptors.response.use(undefined, async (error: AxiosError<APIError>) => {
  if (error.response) {
    throw new Error(error.response.data.message);
  }
  throw error;
});

export interface CurrentUser {
  id: string;
  displayName: string;
}

const currentLCUserState = atom({
  key: 'currentLCUser',
  default: auth.currentUser,
});

const currentUserState = selector({
  key: 'currentUser',
  get: ({ get }): CurrentUser | undefined => {
    const user = get(currentLCUserState);
    if (user) {
      return {
        id: user.id,
        displayName: user.data.name || user.data.username,
      };
    }
  },
});

export const useCurrentUser = () => useRecoilValue(currentUserState);

export const useRefreshCurrentUser = () => {
  const setCurrentUser = useSetRecoilState(currentLCUserState);
  return () => setCurrentUser(auth.currentUser);
};

export interface CustomerServicePermissions {
  view: boolean;
  ticketList: boolean;
  statistics: boolean;
}

export const DefaultGroupPermission: CustomerServicePermissions = {
  view: true,
  ticketList: true,
  statistics: false,
};

const currentUserGroupsState = selector({
  key: 'currentUserGroups',
  get: async ({ get }) => {
    const currentUser = get(currentLCUserState);

    if (!currentUser) {
      return [];
    }

    const groupRoles = await auth
      .queryRole()
      .where('name', 'not-in', ['customerService', 'staff', 'admin', 'collaborator'])
      .find();

    return db
      .query('Group')
      .where(
        'role',
        'in',
        groupRoles.map((role) => db.class('_Role').object(role.id))
      )
      .find();
  },
});

const currentUserPermissions = selector({
  key: 'currentUserPermissions',
  get: async ({ get }) => {
    const groups = get(currentUserGroupsState);

    return mergeWith(
      DefaultGroupPermission,
      ...groups.map((gru) => gru.data.permissions),
      (obj: boolean, src: boolean) => obj || src
    ) as CustomerServicePermissions;
  },
});

export const useCurrentUserPermissions = () => useRecoilValue(currentUserPermissions);

const currentUserRolesState = selector({
  key: 'currentUserRoles',
  get: async ({ get }) => {
    const currentUser = get(currentLCUserState);
    if (!currentUser) {
      return [];
    }
    return auth
      .queryRole()
      .where('name', 'in', ['customerService', 'staff', 'admin'])
      .where('users', '==', currentUser)
      .find()
      .then((roles) => roles.map((role) => role.name));
  },
});

const currentUserIsAdminState = selector({
  key: 'currentUserIsAdmin',
  get: ({ get }) => {
    const roles = get(currentUserRolesState);
    return roles.includes('admin');
  },
});

export const useCurrentUserIsAdmin = () => useRecoilValue(currentUserIsAdminState);

const currentUserIsCustomerServiceState = selector({
  key: 'currentUserIsCS',
  get: ({ get }) => {
    const roles = get(currentUserRolesState);
    return roles.includes('customerService') || roles.includes('admin');
  },
});

export const useCurrentUserIsCustomerService = () =>
  useRecoilValue(currentUserIsCustomerServiceState);

export type LeanCloudRegion = 'cn-n1' | 'cn-e1' | 'us-w1';

export interface LeanCloudApp {
  appId: string;
  appName: string;
  region: LeanCloudRegion;
}

async function getLeanCloudApps(): Promise<LeanCloudApp[]> {
  return cloud.run('getLeanCloudApps');
}

export async function getLeanCloudApp(
  appId: string,
  username: string
): Promise<LeanCloudApp | null> {
  return cloud.run('getLeanCloudApp', { appId, username });
}

export async function getLeanCloudAppUrl(appId: string, region: string): Promise<string | null> {
  return cloud.run('getLeanCloudAppUrl', { appId, region });
}

export function useLeanCloudApps() {
  return useQuery({
    queryKey: 'leanCloudApps',
    queryFn: getLeanCloudApps,
    staleTime: Infinity,
  });
}
