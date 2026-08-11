/**
 * Sign in.
 *
 * This is the reference form implementation every other form in the app copies:
 *   - the Zod schema is imported from shared/, so client and server agree by construction
 *   - mode: 'onChange' gives the real-time inline validation the brief asks for
 *   - submit is disabled while in flight, and the button reports its own state
 *   - server errors are mapped back onto fields, falling back to a form-level message
 */

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { loginSchema } from '@shared/schemas.js';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ROUTES } from '@/config/constants';
import { useAuth } from '@/context/AuthContext';
import { applyServerErrors } from '@/utils/serverErrors';

const FIELD_NAMES = ['email', 'password'];

const LoginPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isValid },
  } = useForm({
    resolver: zodResolver(loginSchema),
    // Validate as the user types, then re-validate on change, so errors clear as soon as
    // they are fixed rather than lingering until the next submit.
    mode: 'onChange',
    reValidateMode: 'onChange',
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values) => {
    setFormError(null);

    const result = await login(values);

    if (!result.ok) {
      const message = applyServerErrors(result.error, setError, FIELD_NAMES);
      if (message) setFormError(message);
      return;
    }

    toast.success(`Welcome back, ${result.data.user.fullName.split(' ')[0]}`);
    // Return them where they were headed before the guard intervened.
    navigate(location.state?.from?.pathname ?? ROUTES.CHAT, { replace: true });
  };

  return (
    <Card>
      <CardHeader>
        {/* A real h1: shadcn's CardTitle renders a div, and this is the page title. */}
        <h1 className="text-xl leading-none font-semibold">Sign in</h1>
        <CardDescription>
          Book and manage appointments by chatting with our assistant.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* noValidate: Zod owns validation, so the browser's own bubbles would compete. */}
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <Field data-invalid={Boolean(errors.email)}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={Boolean(errors.email)}
              {...register('email')}
            />
            {errors.email ? <FieldError>{errors.email.message}</FieldError> : null}
          </Field>

          <Field data-invalid={Boolean(errors.password)}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.password)}
              {...register('password')}
            />
            {errors.password ? <FieldError>{errors.password.message}</FieldError> : null}
          </Field>

          {/* text-* also colours the spinner, which strokes in currentColor. */}
          <Button
            type="submit"
            className="w-full text-primary-foreground-inverted"
            disabled={isSubmitting || !isValid}
          >
            {isSubmitting ? (
              <Spinner role={undefined} aria-label={undefined} aria-hidden="true" />
            ) : null}
            {isSubmitting ? 'Signing in' : 'Sign in'}
          </Button>
        </form>

        <p className="text-muted-foreground mt-4 text-center text-sm">
          Need an account?{' '}
          <Link
            to={ROUTES.SIGNUP}
            className="text-foreground font-medium underline underline-offset-4"
          >
            Create one
          </Link>
        </p>

        {/* Development convenience: the seeded logins, so a reviewer can get straight in. */}
        {import.meta.env.DEV ? (
          <div className="text-muted-foreground bg-muted/50 mt-4 rounded-md p-3 text-xs">
            <p className="font-medium">Demo accounts</p>
            <p>ada@example.com · Password123!</p>
            <p>grace@example.com · Password123!</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default LoginPage;
