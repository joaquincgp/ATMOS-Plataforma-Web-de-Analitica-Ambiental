import { useEffect, useState } from 'react';

import { motion } from 'motion/react';
import {
  User,
  Mail,
  Building,
  Shield,
  Bell,
  Palette,
  Key,
  LogOut,
  Camera,
  Save,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/auth-context';

interface SettingsProps {
  onLogout?: () => void;
}

export function SettingsPanel({ onLogout }: SettingsProps) {
  const { user, logout, updateUserProfile } = useAuth();

  const [profile, setProfile] = useState({
    fullName: user?.full_name ?? 'Dr. María González',
    email: user?.email ?? 'maria.gonzalez@udla.edu.ec',
    institution: 'Environmental Sciences Department',
    role: user?.role === 'admin' ? 'Administrator' : 'Principal Investigator',
    bio: 'Environmental data scientist specializing in air quality monitoring and predictive analytics.',
    phone: '+593 2 123 4567',
  });

  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    dataUpdates: true,
    experimentComplete: true,
    weeklyReport: false,
    securityAlerts: true,
  });

  const [appearance, setAppearance] = useState({
    theme: 'light',
    language: 'en',
    dateFormat: 'MM/DD/YYYY',
  });

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }
    setProfile((current) => ({
      ...current,
      fullName: user.full_name,
      email: user.email,
      role: user.role === 'admin' ? 'Administrator' : user.role === 'generic' ? 'Generic User' : 'Researcher',
    }));
  }, [user]);

  const handleProfileChange = (field: keyof typeof profile, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const handleNotificationChange = (field: keyof typeof notifications, value: boolean) => {
    setNotifications((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveProfile = async () => {
    setSaveError(null);
    setSaveStatus('saving');
    try {
      await updateUserProfile(profile.fullName);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      setSaveStatus('idle');
      setSaveError(err instanceof Error ? err.message : 'Could not update profile.');
    }
  };

  const handleLogout = () => {
    if (onLogout) {
      onLogout();
      return;
    }
    void logout();
  };

  const roleBadge = user?.role === 'admin' ? 'Admin' : user?.role === 'generic' ? 'Generic' : 'Researcher';

  return (
    <div className="h-full bg-[#F9FBFC] overflow-y-auto">
      <div className="max-w-5xl mx-auto p-8">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <h1 className="text-3xl font-bold text-foreground mb-2">Settings</h1>
          <p className="text-muted-foreground">Manage your account and preferences</p>
        </motion.div>

        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList className="bg-white border border-gray-200 p-1 h-auto">
            <TabsTrigger value="profile" className="data-[state=active]:bg-[#509EE3] data-[state=active]:text-white">
              <User className="w-4 h-4 mr-2" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="security" className="data-[state=active]:bg-[#509EE3] data-[state=active]:text-white">
              <Shield className="w-4 h-4 mr-2" />
              Security
            </TabsTrigger>
            <TabsTrigger
              value="notifications"
              className="data-[state=active]:bg-[#509EE3] data-[state=active]:text-white"
            >
              <Bell className="w-4 h-4 mr-2" />
              Notifications
            </TabsTrigger>
            <TabsTrigger
              value="appearance"
              className="data-[state=active]:bg-[#509EE3] data-[state=active]:text-white"
            >
              <Palette className="w-4 h-4 mr-2" />
              Appearance
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <Card className="bg-white border-0 shadow-lg">
                <CardHeader>
                  <CardTitle>Profile Information</CardTitle>
                  <CardDescription>Update your personal details and public profile</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center gap-6">
                    <Avatar className="h-24 w-24">
                      <AvatarImage src="" />
                      <AvatarFallback className="bg-[#509EE3] text-white text-2xl">
                        {profile.fullName
                          .split(' ')
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((part) => part[0]?.toUpperCase())
                          .join('') || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="space-y-2">
                      <Button variant="outline" className="border-[#509EE3] text-[#509EE3] hover:bg-[#509EE3]/10">
                        <Camera className="w-4 h-4 mr-2" />
                        Change Photo
                      </Button>
                      <p className="text-xs text-muted-foreground">JPG, PNG or GIF. Max size 2MB.</p>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="fullName" className="text-sm font-medium">
                        <User className="w-4 h-4 inline mr-2" />
                        Full Name
                      </Label>
                      <Input
                        id="fullName"
                        value={profile.fullName}
                        onChange={(e) => handleProfileChange('fullName', e.target.value)}
                        className="bg-[#F9FBFC] h-11"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-sm font-medium">
                        <Mail className="w-4 h-4 inline mr-2" />
                        Email
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        value={profile.email}
                        onChange={(e) => handleProfileChange('email', e.target.value)}
                        className="bg-[#F9FBFC] h-11"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="institution" className="text-sm font-medium">
                        <Building className="w-4 h-4 inline mr-2" />
                        Institution
                      </Label>
                      <Input
                        id="institution"
                        value={profile.institution}
                        onChange={(e) => handleProfileChange('institution', e.target.value)}
                        className="bg-[#F9FBFC] h-11"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="phone" className="text-sm font-medium">
                        Phone Number
                      </Label>
                      <Input
                        id="phone"
                        value={profile.phone}
                        onChange={(e) => handleProfileChange('phone', e.target.value)}
                        className="bg-[#F9FBFC] h-11"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="role" className="text-sm font-medium">
                      Role
                    </Label>
                    <div className="flex items-center gap-3">
                      <Input
                        id="role"
                        value={profile.role}
                        onChange={(e) => handleProfileChange('role', e.target.value)}
                        className="bg-[#F9FBFC] h-11"
                      />
                      <Badge className="bg-[#509EE3] text-white px-3 py-1">{roleBadge}</Badge>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bio" className="text-sm font-medium">
                      Bio
                    </Label>
                    <textarea
                      id="bio"
                      value={profile.bio}
                      onChange={(e) => handleProfileChange('bio', e.target.value)}
                      rows={4}
                      className="w-full px-3 py-2 bg-[#F9FBFC] border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#509EE3] focus:border-transparent resize-none"
                    />
                  </div>

                  {saveError && <p className="text-sm text-red-600">{saveError}</p>}

                  <div className="flex items-center gap-3 pt-4">
                    <Button
                      onClick={() => void handleSaveProfile()}
                      disabled={saveStatus === 'saving'}
                      className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
                    >
                      {saveStatus === 'saving' && <span className="mr-2">Saving...</span>}
                      {saveStatus === 'saved' && <CheckCircle2 className="w-4 h-4 mr-2" />}
                      {saveStatus === 'idle' && <Save className="w-4 h-4 mr-2" />}
                      {saveStatus === 'saved' ? 'Saved!' : 'Save Changes'}
                    </Button>
                    {saveStatus === 'saved' && (
                      <motion.span
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="text-sm text-green-600 flex items-center"
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" />
                        Profile updated successfully
                      </motion.span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>

          <TabsContent value="security" className="space-y-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <Card className="bg-white border-0 shadow-lg">
                <CardHeader>
                  <CardTitle>Security Settings</CardTitle>
                  <CardDescription>Manage your password and account security</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center">
                      <Key className="w-5 h-5 mr-2 text-[#509EE3]" />
                      Change Password
                    </h3>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="currentPassword">Current Password</Label>
                        <Input
                          id="currentPassword"
                          type="password"
                          placeholder="••••••••"
                          className="bg-[#F9FBFC] h-11"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="newPassword">New Password</Label>
                        <Input id="newPassword" type="password" placeholder="••••••••" className="bg-[#F9FBFC] h-11" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="confirmNewPassword">Confirm New Password</Label>
                        <Input
                          id="confirmNewPassword"
                          type="password"
                          placeholder="••••••••"
                          className="bg-[#F9FBFC] h-11"
                        />
                      </div>
                      <Button className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white">Update Password</Button>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center">
                      <Shield className="w-5 h-5 mr-2 text-[#509EE3]" />
                      Two-Factor Authentication
                    </h3>
                    <div className="flex items-center justify-between p-4 bg-[#F9FBFC] rounded-lg">
                      <div>
                        <p className="font-medium">Enable 2FA</p>
                        <p className="text-sm text-muted-foreground">Add an extra layer of security to your account</p>
                      </div>
                      <Switch />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Active Sessions</h3>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-4 bg-[#F9FBFC] rounded-lg">
                        <div>
                          <p className="font-medium">Current Session</p>
                          <p className="text-xs text-muted-foreground">Quito, Ecuador · Browser session · Active now</p>
                        </div>
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Active</Badge>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-[#F9FBFC] rounded-lg">
                        <div>
                          <p className="font-medium">Secondary Session</p>
                          <p className="text-xs text-muted-foreground">Last active 2 days ago</p>
                        </div>
                        <Button variant="outline" size="sm">
                          Revoke
                        </Button>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4 border-2 border-red-200 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-red-600 flex items-center">
                      <AlertCircle className="w-5 h-5 mr-2" />
                      Danger Zone
                    </h3>
                    <div className="space-y-3">
                      <Button variant="outline" className="border-red-300 text-red-600 hover:bg-red-50" onClick={handleLogout}>
                        <LogOut className="w-4 h-4 mr-2" />
                        Log Out
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <Card className="bg-white border-0 shadow-lg">
                <CardHeader>
                  <CardTitle>Notification Preferences</CardTitle>
                  <CardDescription>Choose what updates you want to receive</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-[#F9FBFC] rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium">Email Alerts</p>
                        <p className="text-sm text-muted-foreground">Receive email notifications for important updates</p>
                      </div>
                      <Switch
                        checked={notifications.emailAlerts}
                        onCheckedChange={(checked) => handleNotificationChange('emailAlerts', checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between p-4 bg-[#F9FBFC] rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium">Data Updates</p>
                        <p className="text-sm text-muted-foreground">Get notified when new data is available</p>
                      </div>
                      <Switch
                        checked={notifications.dataUpdates}
                        onCheckedChange={(checked) => handleNotificationChange('dataUpdates', checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between p-4 bg-[#F9FBFC] rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium">Experiment Completion</p>
                        <p className="text-sm text-muted-foreground">Notify when ML experiments finish running</p>
                      </div>
                      <Switch
                        checked={notifications.experimentComplete}
                        onCheckedChange={(checked) => handleNotificationChange('experimentComplete', checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between p-4 bg-[#F9FBFC] rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium">Weekly Reports</p>
                        <p className="text-sm text-muted-foreground">Receive weekly summaries of your research activity</p>
                      </div>
                      <Switch
                        checked={notifications.weeklyReport}
                        onCheckedChange={(checked) => handleNotificationChange('weeklyReport', checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between p-4 bg-[#F9FBFC] rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium">Security Alerts</p>
                        <p className="text-sm text-muted-foreground">Important security and account notifications</p>
                      </div>
                      <Switch
                        checked={notifications.securityAlerts}
                        onCheckedChange={(checked) => handleNotificationChange('securityAlerts', checked)}
                      />
                    </div>
                  </div>

                  <Button className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white">
                    <Save className="w-4 h-4 mr-2" />
                    Save Preferences
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>

          <TabsContent value="appearance" className="space-y-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <Card className="bg-white border-0 shadow-lg">
                <CardHeader>
                  <CardTitle>Appearance Settings</CardTitle>
                  <CardDescription>Customize how ATMOS looks to you</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-3">
                      <Label className="text-base font-semibold">Theme</Label>
                      <div className="grid grid-cols-3 gap-3">
                        <button
                          onClick={() => setAppearance({ ...appearance, theme: 'light' })}
                          className={`p-4 rounded-lg border-2 transition-all ${
                            appearance.theme === 'light'
                              ? 'border-[#509EE3] bg-[#509EE3]/5'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="w-full h-16 bg-white rounded border mb-2"></div>
                          <p className="text-sm font-medium">Light</p>
                        </button>
                        <button
                          onClick={() => setAppearance({ ...appearance, theme: 'dark' })}
                          className={`p-4 rounded-lg border-2 transition-all ${
                            appearance.theme === 'dark'
                              ? 'border-[#509EE3] bg-[#509EE3]/5'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="w-full h-16 bg-gray-900 rounded border mb-2"></div>
                          <p className="text-sm font-medium">Dark</p>
                        </button>
                        <button
                          onClick={() => setAppearance({ ...appearance, theme: 'auto' })}
                          className={`p-4 rounded-lg border-2 transition-all ${
                            appearance.theme === 'auto'
                              ? 'border-[#509EE3] bg-[#509EE3]/5'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="w-full h-16 bg-gradient-to-r from-white to-gray-900 rounded border mb-2"></div>
                          <p className="text-sm font-medium">Auto</p>
                        </button>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-3">
                      <Label htmlFor="language" className="text-base font-semibold">
                        Language
                      </Label>
                      <select
                        id="language"
                        value={appearance.language}
                        onChange={(e) => setAppearance({ ...appearance, language: e.target.value })}
                        className="w-full px-3 py-2 bg-[#F9FBFC] border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#509EE3] h-11"
                      >
                        <option value="en">English</option>
                        <option value="es">Español</option>
                        <option value="pt">Português</option>
                      </select>
                    </div>

                    <div className="space-y-3">
                      <Label htmlFor="dateFormat" className="text-base font-semibold">
                        Date Format
                      </Label>
                      <select
                        id="dateFormat"
                        value={appearance.dateFormat}
                        onChange={(e) => setAppearance({ ...appearance, dateFormat: e.target.value })}
                        className="w-full px-3 py-2 bg-[#F9FBFC] border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#509EE3] h-11"
                      >
                        <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                        <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                        <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                      </select>
                    </div>
                  </div>

                  <Button className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white">
                    <Save className="w-4 h-4 mr-2" />
                    Save Preferences
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
