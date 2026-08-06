/**
 * Create an account.
 *
 * Same pattern as LoginPage — shared Zod schema, real-time validation, server errors mapped
 * back onto fields.
 *
 * Note there is no role selector. The original brief for a larger platform had patient/doctor
 * signup, but this assessment defines no doctor-facing surface, so self-signup is always a
 * customer and the server ignores any role in the payload. Documented in the README.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { signupSchema } from '@shared/schemas.ts';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ROUTES } from '@/config/constants';
import { useAuth } from '@/context/AuthContext';
import { applyServerErrors } from '@/utils/serverErrors';

const FIELD_NAMES = ['fullName', 'email', 'password', 'phone'];

const SignupPage = () => {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isValid },
  } = useForm({
    resolver: zodResolver(signupSchema),
    mode: 'onChange',
    reValidateMode: 'onChange',
    defaultValues: { fullName: '', email: '', password: '', phone: '' },
  });

  const onSubmit = async (values) => {
    setFormError(null);

    // An empty optional field should be absent, not an empty string.
    const payload = { ...values, phone: values.phone?.trim() ? values.phone.trim() : undefined };

    const result = await signup(payload);

    if (!result.ok) {
      const message = applyServerErrors(result.error, setError, FIELD_NAMES);
      if (message) setFormError(message);
      return;
    }

    toast.success('Account created');
    navigate(ROUTES.CHAT, { replace: true });
  };

  return (
    <Card>
      <CardHeader>
        {/* A real h1 — see the note in LoginPage. */}
        <h1 className="text-xl leading-none font-semibold">Create an account</h1>
        <CardDescription>It takes a moment, and then you can book by chatting.</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <Field data-invalid={Boolean(errors.fullName)}>
            <FieldLabel htmlFor="fullName">Full name</FieldLabel>
            <Input
              id="fullName"
              autoComplete="name"
              placeholder="Ada Lovelace"
              aria-invalid={Boolean(errors.fullName)}
              {...register('fullName')}
            />
            {errors.fullName ? <FieldError>{errors.fullName.message}</FieldError> : null}
          </Field>

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
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              {...register('password')}
            />
            {errors.password ? (
              <FieldError>{errors.password.message}</FieldError>
            ) : (
              <FieldDescription>At least 8 characters.</FieldDescription>
            )}
          </Field>

          <Field data-invalid={Boolean(errors.phone)}>
            <FieldLabel htmlFor="phone">Phone (optional)</FieldLabel>
            <Input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder="+1 555 0100"
              aria-invalid={Boolean(errors.phone)}
              {...register('phone')}
            />
            {errors.phone ? <FieldError>{errors.phone.message}</FieldError> : null}
          </Field>

          <Button type="submit" className="w-full" disabled={isSubmitting || !isValid}>
            {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {isSubmitting ? 'Creating account' : 'Create account'}
          </Button>
        </form>

        <p className="text-muted-foreground mt-4 text-center text-sm">
          Already have an account?{' '}
          <Link
            to={ROUTES.LOGIN}
            className="text-foreground font-medium underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
};

export default SignupPage;
