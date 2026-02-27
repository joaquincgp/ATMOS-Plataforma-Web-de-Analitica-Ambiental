import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ForgotPasswordValues {
  email: string;
}

interface ForgotPasswordProps {
  onSend: (email: string) => Promise<{ message: string; debug_reset_token?: string | null }>;
  onBackToLogin: () => void;
  onOpenResetPassword: (token?: string) => void;
}

export function ForgotPassword({ onSend, onBackToLogin, onOpenResetPassword }: ForgotPasswordProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenHint, setTokenHint] = useState<string | null>(null);

  const form = useForm<ForgotPasswordValues>({ defaultValues: { email: '' } });

  const submit = form.handleSubmit(async (values) => {
    setMessage(null);
    setError(null);
    setTokenHint(null);
    try {
      const response = await onSend(values.email);
      setMessage(response.message);
      if (response.debug_reset_token) {
        setTokenHint(response.debug_reset_token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start password reset.');
    }
  });

  return (
    <div className="min-h-screen bg-[#F9FBFC] flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-white shadow-lg">
        <CardHeader className="space-y-2 text-center">
          <CardTitle>Forgot Password</CardTitle>
          <CardDescription>We will generate a one-time token to reset your password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                type="email"
                {...form.register('email', {
                  required: 'Email is required.',
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: 'Invalid email format.',
                  },
                })}
              />
              {form.formState.errors.email && (
                <p className="text-sm text-red-600">{form.formState.errors.email.message}</p>
              )}
            </div>

            {message && <p className="text-sm text-green-700">{message}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {tokenHint && (
              <div className="rounded-md border border-[#509EE3]/30 bg-[#f0f7ff] p-2 text-xs">
                <p className="font-semibold text-[#1F5A8A]">Development reset token:</p>
                <p className="mt-1 break-all">{tokenHint}</p>
                <button
                  type="button"
                  onClick={() => onOpenResetPassword(tokenHint)}
                  className="mt-2 text-[#509EE3] hover:underline"
                >
                  Continue to reset form
                </button>
              </div>
            )}

            <Button type="submit" className="w-full bg-[#509EE3] hover:bg-[#509EE3]/90 text-white">
              Send reset link
            </Button>

            <div className="text-center">
              <button type="button" onClick={onBackToLogin} className="text-sm text-[#509EE3] hover:underline">
                Back to login
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
