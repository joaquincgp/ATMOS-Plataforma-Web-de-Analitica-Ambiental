import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface LoginProps {
  onLogin: () => void;
}

export function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin();
  };

  return (
    <div className="min-h-screen bg-[#F9FBFC] flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-white shadow-lg">
        <CardHeader className="space-y-4 text-center pb-8">
          {/* Logos */}
          <div className="flex items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-[#509EE3] flex items-center justify-center">
              <span className="text-white font-bold text-xl">A</span>
            </div>
            <div className="w-12 h-12 rounded-lg bg-gray-800 flex items-center justify-center">
              <span className="text-white font-bold text-sm">UDLA</span>
            </div>
          </div>
          
          {/* Title */}
          <div>
            <CardTitle className="text-2xl font-semibold text-foreground">ATMOS</CardTitle>
            <CardDescription className="text-sm text-muted-foreground mt-2">
              Environmental Data Analytics Platform
            </CardDescription>
          </div>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="researcher@udla.edu.ec"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-[#F9FBFC]"
                required
              />
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-[#F9FBFC]"
                required
              />
            </div>

            {/* Sign In Button */}
            <Button
              type="submit"
              className="w-full bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
            >
              Sign In
            </Button>

            {/* Forgot Password Link */}
            <div className="text-center">
              <button
                type="button"
                className="text-sm text-[#509EE3] hover:underline"
              >
                Forgot Password?
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="absolute bottom-4 text-center text-xs text-muted-foreground">
        <p>Universidad de Las Américas - Environmental Research</p>
      </div>
    </div>
  );
}
