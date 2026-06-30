import { useEffect, useMemo, useState } from 'react';

import { motion } from 'motion/react';
import {
  Activity,
  AlertCircle,
  BadgeCheck,
  Ban,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock,
  Database,
  Globe2,
  Hash,
  IdCard,
  Phone,
  RotateCcw,
  Save,
  Search,
  Shield,
  Trash2,
  User,
  Users,
  Zap,
} from 'lucide-react';

import { getAppConfig, resetAppConfig, updateAppConfig, type AppConfigItem } from '@/api/modules/app-config';
import {
  deactivateAdminUser,
  listAdminUsers,
  updateAdminUser,
  type AdminUserResponse,
  type UserRole,
  type UserStatus,
} from '@/api/modules/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/components/ui/utils';
import { useAuth } from '@/contexts/auth-context';

type SaveStatus = 'idle' | 'saving' | 'saved';
type AdminSection = 'users' | 'engine' | 'query' | 'workspace';

const ENGINE_KEYS = [
  'analytics.max_statsmodels_points',
  'analytics.max_prophet_points',
  'analytics.max_figure_points',
  'analytics.min_series_length_sarima',
  'analytics.min_series_length_arima',
  'analytics.min_series_length_prophet',
  'analytics.anomaly_iqr_multiplier',
];

const QUERY_KEYS = ['analytics.default_query_limit', 'analytics.source_list_limit'];

const WORKSPACE_KEYS = [
  'workspace.default_rolling_window',
  'workspace.default_decomposition_window',
  'workspace.default_forecast_horizon',
  'workspace.default_changepoint_window',
  'workspace.default_changepoint_sensitivity',
  'workspace.default_histogram_bins',
  'workspace.default_confidence_level',
  'workspace.default_marker_opacity',
  'workspace.default_marker_size',
  'workspace.default_facet_columns',
];

const ADMIN_SECTIONS: {
  id: AdminSection;
  label: string;
  description: string;
  icon: typeof Users;
}[] = [
  { id: 'users', label: 'Users', description: 'Roles, access and last activity', icon: Users },
  { id: 'engine', label: 'Analytics Engine', description: 'Model limits and anomaly rules', icon: Zap },
  { id: 'query', label: 'Query Limits', description: 'Rows and filter list caps', icon: Database },
  { id: 'workspace', label: 'Workspace Defaults', description: 'Initial chart controls', icon: BarChart3 },
];

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  researcher: 'Researcher',
  generic: 'Generic',
};

const STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Active',
  pending_validation: 'Pending',
  suspended: 'Suspended',
};

const PHONE_PATTERN = /^[0-9+()\-\s.]*$/;

function indexConfig(items: AppConfigItem[]) {
  return new Map(items.map((item) => [item.key, item]));
}

function nullable(value: string) {
  const clean = value.trim();
  return clean.length > 0 ? clean : null;
}

function formatDate(value?: string | null) {
  if (!value) {
    return 'Never';
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function statusBadgeClass(status: UserStatus) {
  if (status === 'active') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (status === 'suspended') {
    return 'bg-red-50 text-red-700 border-red-200';
  }
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

function roleBadgeClass(role: UserRole) {
  if (role === 'admin') {
    return 'bg-[#E8F4FD] text-[#1F5A8A] border-[#B8DCF5]';
  }
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

export function SettingsPanel() {
  const { user, updateUserProfile, deleteAccount } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canDeleteOwnAccount = user?.role === 'researcher' || user?.role === 'generic';

  const [profile, setProfile] = useState({
    fullName: '',
    institution: '',
    jobTitle: '',
    department: '',
    phone: '',
    country: '',
  });
  const [profileStatus, setProfileStatus] = useState<SaveStatus>('idle');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileFieldErrors, setProfileFieldErrors] = useState<Record<string, string>>({});
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const [activeAdminSection, setActiveAdminSection] = useState<AdminSection>('users');
  const [users, setUsers] = useState<AdminUserResponse[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const [configItems, setConfigItems] = useState<AppConfigItem[]>([]);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [configLoading, setConfigLoading] = useState(false);
  const [configStatus, setConfigStatus] = useState<SaveStatus>('idle');
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }
    setProfile({
      fullName: user.full_name ?? '',
      institution: user.institution ?? '',
      jobTitle: user.job_title ?? '',
      department: user.department ?? '',
      phone: user.phone ?? '',
      country: user.country ?? '',
    });
  }, [user]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    const loadConfig = async () => {
      setConfigLoading(true);
      setConfigError(null);
      try {
        const response = await getAppConfig();
        setConfigItems(response.items);
        setConfigValues(Object.fromEntries(response.items.map((item) => [item.key, String(item.value)])));
      } catch (err) {
        setConfigError(err instanceof Error ? err.message : 'Could not load admin configuration.');
      } finally {
        setConfigLoading(false);
      }
    };

    const loadUsers = async () => {
      setUsersLoading(true);
      setUsersError(null);
      try {
        setUsers(await listAdminUsers());
      } catch (err) {
        setUsersError(err instanceof Error ? err.message : 'Could not load users.');
      } finally {
        setUsersLoading(false);
      }
    };

    void loadConfig();
    void loadUsers();
  }, [isAdmin]);

  const configByKey = useMemo(() => indexConfig(configItems), [configItems]);
  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    if (!query) {
      return users;
    }
    return users.filter((item) =>
      [item.full_name, item.email, item.role, item.status, item.institution ?? ''].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [userSearch, users]);
  const roleBadge = user?.role === 'admin' ? 'Admin' : user?.role === 'generic' ? 'Generic' : 'Researcher';

  const handleSaveProfile = async () => {
    setProfileError(null);
    const errors: Record<string, string> = {};

    if (!profile.fullName.trim()) {
      errors.fullName = 'Ingresa tu nombre completo.';
    } else if (profile.fullName.trim().length < 2) {
      errors.fullName = 'El nombre debe tener al menos 2 caracteres.';
    } else if (profile.fullName.trim().length > 255) {
      errors.fullName = 'El nombre no puede superar 255 caracteres.';
    }

    for (const [field, value] of [
      ['institution', profile.institution],
      ['jobTitle', profile.jobTitle],
      ['department', profile.department],
    ] as const) {
      if (value.trim().length > 255) {
        errors[field] = 'Este campo no puede superar 255 caracteres.';
      }
    }

    if (profile.phone.trim().length > 64) {
      errors.phone = 'El teléfono no puede superar 64 caracteres.';
    } else if (!PHONE_PATTERN.test(profile.phone.trim())) {
      errors.phone = 'Usa solo números, espacios, +, paréntesis, guiones o puntos.';
    }

    if (profile.country.trim().length > 128) {
      errors.country = 'El país no puede superar 128 caracteres.';
    }

    setProfileFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setProfileError('Revisa los campos marcados antes de guardar.');
      return;
    }

    setProfileStatus('saving');
    try {
      await updateUserProfile({
        full_name: profile.fullName.trim(),
        institution: nullable(profile.institution),
        job_title: nullable(profile.jobTitle),
        department: nullable(profile.department),
        phone: nullable(profile.phone),
        country: nullable(profile.country),
      });
      setProfileStatus('saved');
      setTimeout(() => setProfileStatus('idle'), 2000);
    } catch (err) {
      setProfileStatus('idle');
      setProfileError(err instanceof Error ? err.message : 'Could not update profile.');
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteError(null);
    if (deleteConfirmation.trim() !== 'DELETE') {
      setDeleteError('Type DELETE to confirm account deletion.');
      return;
    }

    setIsDeletingAccount(true);
    try {
      await deleteAccount();
    } catch (err) {
      setIsDeletingAccount(false);
      setDeleteError(err instanceof Error ? err.message : 'Could not delete account.');
    }
  };

  const handleSaveConfig = async () => {
    setConfigError(null);
    setConfigStatus('saving');
    try {
      const response = await updateAppConfig({
        items: configItems.map((item) => ({
          key: item.key,
          value: Number(configValues[item.key] ?? item.value),
        })),
      });
      setConfigItems(response.items);
      setConfigValues(Object.fromEntries(response.items.map((item) => [item.key, String(item.value)])));
      setConfigStatus('saved');
      setTimeout(() => setConfigStatus('idle'), 2000);
    } catch (err) {
      setConfigStatus('idle');
      setConfigError(err instanceof Error ? err.message : 'Could not save admin configuration.');
    }
  };

  const handleResetConfig = async () => {
    setConfigError(null);
    setConfigStatus('saving');
    try {
      const response = await resetAppConfig();
      setConfigItems(response.items);
      setConfigValues(Object.fromEntries(response.items.map((item) => [item.key, String(item.value)])));
      setConfigStatus('saved');
      setTimeout(() => setConfigStatus('idle'), 2000);
    } catch (err) {
      setConfigStatus('idle');
      setConfigError(err instanceof Error ? err.message : 'Could not reset admin configuration.');
    }
  };

  const handleUpdateUser = async (userId: string, payload: { role?: UserRole; status?: UserStatus }) => {
    setUsersError(null);
    setUpdatingUserId(userId);
    try {
      const updated = await updateAdminUser(userId, payload);
      setUsers((current) => current.map((item) => (item.id === userId ? updated : item)));
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Could not update user.');
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleDeactivateUser = async (userId: string) => {
    setUsersError(null);
    setUpdatingUserId(userId);
    try {
      await deactivateAdminUser(userId);
      setUsers((current) =>
        current.map((item) => (item.id === userId ? { ...item, status: 'suspended', is_active: false } : item)),
      );
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Could not deactivate user.');
    } finally {
      setUpdatingUserId(null);
    }
  };

  const renderConfigFields = (keys: string[]) => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {keys.map((key) => {
        const item = configByKey.get(key);
        if (!item) {
          return null;
        }
        return (
          <div key={key} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor={key} className="text-sm font-semibold text-[#24384D]">
                  {item.description}
                </Label>
                <p className="mt-1 truncate text-xs text-slate-500">{item.key}</p>
              </div>
              <Badge variant="outline" className="shrink-0 border-[#B8DCF5] bg-[#E8F4FD] text-[#1F5A8A]">
                Default {item.default_value}
              </Badge>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[#F1F8FE] text-[#509EE3]">
                <Hash className="size-4" />
              </div>
              <Input
                id={key}
                type="number"
                step={Number.isInteger(item.default_value) ? 1 : 0.01}
                value={configValues[key] ?? ''}
                onChange={(event) => setConfigValues((current) => ({ ...current, [key]: event.target.value }))}
                className="h-11 bg-[#F9FBFC]"
              />
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderUsersSection = () => (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-[#24384D]">User Administration</h3>
          <p className="text-sm text-slate-500">Promote admins, review access state and suspend accounts.</p>
        </div>
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
            placeholder="Search users"
            className="h-10 bg-[#F9FBFC] pl-9"
          />
        </div>
      </div>

      {usersError && (
        <p className="flex items-center text-sm text-red-600">
          <AlertCircle className="mr-2 size-4" />
          {usersError}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <Table>
          <TableHeader className="bg-[#F9FBFC]">
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Last Access</TableHead>
              <TableHead>Workspaces</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                  Loading users...
                </TableCell>
              </TableRow>
            ) : filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((item) => {
                const isSelf = item.id === user?.id;
                const isUpdating = updatingUserId === item.id;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="min-w-[260px]">
                      <div className="font-medium text-[#24384D]">{item.full_name}</div>
                      <div className="text-xs text-slate-500">{item.email}</div>
                      {item.institution && <div className="text-xs text-slate-400">{item.institution}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('capitalize', statusBadgeClass(item.status))}>
                        {STATUS_LABELS[item.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={roleBadgeClass(item.role)}>
                        {ROLE_LABELS[item.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center text-sm text-slate-600">
                        <Clock className="mr-2 size-4 text-slate-400" />
                        {formatDate(item.last_login_at)}
                      </div>
                    </TableCell>
                    <TableCell>{item.workspace_count}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Select
                          value={item.role}
                          disabled={isUpdating || isSelf}
                          onValueChange={(value) => void handleUpdateUser(item.id, { role: value as UserRole })}
                        >
                          <SelectTrigger className="h-9 w-[130px] bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="researcher">Researcher</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={item.status === 'pending_validation' ? undefined : item.status}
                          disabled={isUpdating || isSelf}
                          onValueChange={(value) => void handleUpdateUser(item.id, { status: value as UserStatus })}
                        >
                          <SelectTrigger className="h-9 w-[130px] bg-white">
                            <SelectValue placeholder="Change status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="suspended">Suspended</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          disabled={isUpdating || isSelf || item.status === 'suspended'}
                          onClick={() => void handleDeactivateUser(item.id)}
                          className="h-9 w-9 border-red-200 text-red-600 hover:bg-red-50"
                          title="Deactivate access"
                        >
                          <Ban className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  const renderAdminContent = () => {
    if (activeAdminSection === 'users') {
      return renderUsersSection();
    }

    const sectionMap = {
      engine: {
        title: 'Analytics Engine',
        description: 'Controls model input size, chart rendering limits and anomaly sensitivity.',
        keys: ENGINE_KEYS,
      },
      query: {
        title: 'Query Limits',
        description: 'Controls default row limits and filter source list size across data tools.',
        keys: QUERY_KEYS,
      },
      workspace: {
        title: 'Workspace Defaults',
        description: 'Controls initial values used when a user opens the Analytical Workspace.',
        keys: WORKSPACE_KEYS,
      },
    } satisfies Record<Exclude<AdminSection, 'users'>, { title: string; description: string; keys: string[] }>;

    const section = sectionMap[activeAdminSection];
    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-xl font-semibold text-[#24384D]">{section.title}</h3>
          <p className="text-sm text-slate-500">{section.description}</p>
        </div>
        {configLoading ? <p className="text-sm text-slate-500">Loading configuration...</p> : renderConfigFields(section.keys)}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto bg-[#F9FBFC]">
      <div className="mx-auto w-full max-w-none px-4 py-5 lg:px-6 lg:py-6">
        <div className="mx-auto w-full max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-8"
          >
            <h1 className="mb-2 text-3xl font-bold text-foreground">Settings</h1>
            <p className="text-muted-foreground">Manage account details and operational configuration.</p>
          </motion.div>
        </div>

        <Tabs defaultValue="profile" className="space-y-6">
          <div className="mx-auto w-full max-w-7xl">
            <TabsList className="h-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-sm">
              <TabsTrigger
                value="profile"
                className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-all duration-300 ease-out data-[state=active]:bg-[#509EE3] data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:shadow-[#509EE3]/20"
              >
                <User className="mr-2 size-4" />
                Profile
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger
                  value="admin"
                  className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-all duration-300 ease-out data-[state=active]:bg-[#509EE3] data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:shadow-[#509EE3]/20"
                >
                  <Shield className="mr-2 size-4" />
                  Admin Panel
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          <TabsContent value="profile" className="mx-auto w-full max-w-6xl space-y-4">
            <Card className="w-full border-0 bg-white shadow-lg">
              <CardHeader className="p-6 lg:p-8">
                <CardTitle>Profile Information</CardTitle>
                <CardDescription>Update the personal details stored for your account.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-7 p-6 pt-0 lg:p-8 lg:pt-0">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge className="bg-[#509EE3] px-3 py-1 text-white">
                    <BadgeCheck className="mr-1 size-4" />
                    {roleBadge}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{user?.email}</span>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="fullName" className="text-sm font-medium">
                      <User className="mr-2 inline size-4" />
                      Full Name
                    </Label>
                    <Input
                      id="fullName"
                      value={profile.fullName}
                      onChange={(event) => {
                        setProfile((current) => ({ ...current, fullName: event.target.value }));
                        setProfileFieldErrors((current) => ({ ...current, fullName: '' }));
                      }}
                      className="h-11 bg-[#F9FBFC]"
                      aria-invalid={Boolean(profileFieldErrors.fullName)}
                    />
                    {profileFieldErrors.fullName && <p className="text-xs text-red-600">{profileFieldErrors.fullName}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="institution" className="text-sm font-medium">
                      <Building2 className="mr-2 inline size-4" />
                      Institution
                    </Label>
                    <Input
                      id="institution"
                      value={profile.institution}
                      onChange={(event) => {
                        setProfile((current) => ({ ...current, institution: event.target.value }));
                        setProfileFieldErrors((current) => ({ ...current, institution: '' }));
                      }}
                      className="h-11 bg-[#F9FBFC]"
                      aria-invalid={Boolean(profileFieldErrors.institution)}
                    />
                    {profileFieldErrors.institution && (
                      <p className="text-xs text-red-600">{profileFieldErrors.institution}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="jobTitle" className="text-sm font-medium">
                      <IdCard className="mr-2 inline size-4" />
                      Job Title
                    </Label>
                    <Input
                      id="jobTitle"
                      value={profile.jobTitle}
                      onChange={(event) => {
                        setProfile((current) => ({ ...current, jobTitle: event.target.value }));
                        setProfileFieldErrors((current) => ({ ...current, jobTitle: '' }));
                      }}
                      className="h-11 bg-[#F9FBFC]"
                      aria-invalid={Boolean(profileFieldErrors.jobTitle)}
                    />
                    {profileFieldErrors.jobTitle && <p className="text-xs text-red-600">{profileFieldErrors.jobTitle}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="department" className="text-sm font-medium">
                      Department
                    </Label>
                    <Input
                      id="department"
                      value={profile.department}
                      onChange={(event) => {
                        setProfile((current) => ({ ...current, department: event.target.value }));
                        setProfileFieldErrors((current) => ({ ...current, department: '' }));
                      }}
                      className="h-11 bg-[#F9FBFC]"
                      aria-invalid={Boolean(profileFieldErrors.department)}
                    />
                    {profileFieldErrors.department && (
                      <p className="text-xs text-red-600">{profileFieldErrors.department}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone" className="text-sm font-medium">
                      <Phone className="mr-2 inline size-4" />
                      Phone
                    </Label>
                    <Input
                      id="phone"
                      value={profile.phone}
                      onChange={(event) => {
                        setProfile((current) => ({ ...current, phone: event.target.value }));
                        setProfileFieldErrors((current) => ({ ...current, phone: '' }));
                      }}
                      className="h-11 bg-[#F9FBFC]"
                      aria-invalid={Boolean(profileFieldErrors.phone)}
                    />
                    {profileFieldErrors.phone && <p className="text-xs text-red-600">{profileFieldErrors.phone}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="country" className="text-sm font-medium">
                      <Globe2 className="mr-2 inline size-4" />
                      Country
                    </Label>
                    <Input
                      id="country"
                      value={profile.country}
                      onChange={(event) => {
                        setProfile((current) => ({ ...current, country: event.target.value }));
                        setProfileFieldErrors((current) => ({ ...current, country: '' }));
                      }}
                      className="h-11 bg-[#F9FBFC]"
                      aria-invalid={Boolean(profileFieldErrors.country)}
                    />
                    {profileFieldErrors.country && <p className="text-xs text-red-600">{profileFieldErrors.country}</p>}
                  </div>
                </div>

                {profileError && (
                  <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{profileError}</span>
                  </div>
                )}

                {profileStatus === 'saved' && (
                  <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    <span>Profile updated successfully.</span>
                  </div>
                )}

                <Button
                  onClick={() => void handleSaveProfile()}
                  disabled={profileStatus === 'saving'}
                  className="bg-[#509EE3] text-white hover:bg-[#509EE3]/90"
                >
                  {profileStatus === 'saving' ? (
                    <span className="mr-2">Saving...</span>
                  ) : profileStatus === 'saved' ? (
                    <CheckCircle2 className="mr-2 size-4" />
                  ) : (
                    <Save className="mr-2 size-4" />
                  )}
                  {profileStatus === 'saved' ? 'Saved' : 'Save Changes'}
                </Button>
              </CardContent>
            </Card>

            {canDeleteOwnAccount ? (
              <Card className="w-full border border-red-100 bg-white shadow-lg">
                <CardHeader className="p-6 pb-4 lg:p-8 lg:pb-4">
                  <CardTitle className="flex items-center text-red-700">
                    <Trash2 className="mr-2 size-5" />
                    Delete Account
                  </CardTitle>
                  <CardDescription>
                    Permanently delete your account and sign out of ATMOS.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-6 pt-0 lg:p-8 lg:pt-0">
                  <div className="max-w-sm space-y-2">
                    <Label htmlFor="deleteConfirmation" className="text-sm font-medium text-red-800">
                      Type DELETE to confirm
                    </Label>
                    <Input
                      id="deleteConfirmation"
                      value={deleteConfirmation}
                      onChange={(event) => {
                        setDeleteConfirmation(event.target.value);
                        setDeleteError(null);
                      }}
                      className="h-11 border-red-200 bg-[#F9FBFC] focus:border-red-400 focus:ring-red-400"
                      autoComplete="off"
                    />
                  </div>
                  {deleteError ? (
                    <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      <span>{deleteError}</span>
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleDeleteAccount()}
                    disabled={isDeletingAccount}
                    className="border-red-200 bg-white text-red-700 hover:bg-red-50 hover:text-red-800"
                  >
                    <Trash2 className="mr-2 size-4" />
                    {isDeletingAccount ? 'Deleting...' : 'Delete My Account'}
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          {isAdmin && (
            <TabsContent value="admin" className="w-full">
              <div className="grid w-full gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                <Card className="h-fit border-0 bg-white shadow-lg">
                  <CardHeader className="p-5">
                    <CardTitle className="flex items-center text-[#24384D]">
                      <Activity className="mr-2 size-5 text-[#509EE3]" />
                      Admin Panel
                    </CardTitle>
                    <CardDescription>System access and Analytical Workspace parameters.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 p-5 pt-0">
                    {ADMIN_SECTIONS.map((section) => {
                      const Icon = section.icon;
                      const selected = activeAdminSection === section.id;
                      return (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => setActiveAdminSection(section.id)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-lg border px-3.5 py-4 text-left transition-colors',
                            selected
                              ? 'border-[#B8DCF5] bg-[#E8F4FD] text-[#1F5A8A]'
                              : 'border-transparent bg-white text-slate-600 hover:bg-[#F9FBFC]',
                          )}
                        >
                          <span
                            className={cn(
                              'flex size-9 shrink-0 items-center justify-center rounded-md',
                              selected ? 'bg-white text-[#509EE3]' : 'bg-slate-100 text-slate-500',
                            )}
                          >
                            <Icon className="size-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block font-medium">{section.label}</span>
                            <span className="block text-xs leading-5 opacity-75">{section.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </CardContent>
                </Card>

                <Card className="min-w-0 border-0 bg-white shadow-lg">
                  <CardContent className="p-4 lg:p-5">
                    {renderAdminContent()}

                    {activeAdminSection !== 'users' && (
                      <>
                        {configError && (
                          <p className="mt-5 flex items-center text-sm text-red-600">
                            <AlertCircle className="mr-2 size-4" />
                            {configError}
                          </p>
                        )}

                        <div className="mt-6 flex flex-wrap items-center gap-3">
                          <Button
                            onClick={() => void handleSaveConfig()}
                            disabled={configStatus === 'saving' || configLoading}
                            className="bg-[#509EE3] text-white hover:bg-[#509EE3]/90"
                          >
                            {configStatus === 'saving' ? (
                              <span className="mr-2">Saving...</span>
                            ) : configStatus === 'saved' ? (
                              <CheckCircle2 className="mr-2 size-4" />
                            ) : (
                              <Save className="mr-2 size-4" />
                            )}
                            {configStatus === 'saved' ? 'Saved' : 'Save Configuration'}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void handleResetConfig()}
                            disabled={configStatus === 'saving' || configLoading}
                          >
                            <RotateCcw className="mr-2 size-4" />
                            Reset to Defaults
                          </Button>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}
