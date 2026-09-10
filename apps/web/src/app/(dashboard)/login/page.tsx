"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { api, describeError } from "@/lib/api";
import { AuthShell } from "@/components/auth/auth-shell";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof loginSchema>) {
    setError(null);
    try {
      await api.post("/v1/auth/login", values);
      router.push(getReturnPath(searchParams.get("returnTo")));
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <AuthShell>
      <Card className="auth-card">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Manage wallets, policy and approvals from your Paymod dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </Form>
          <p className="auth-switch">
            No account? <Link href={getSignupHref(searchParams.get("returnTo"))}>Create one</Link>
          </p>
        </CardContent>
      </Card>
    </AuthShell>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<AuthShell><p>Preparing sign in...</p></AuthShell>}><LoginContent /></Suspense>;
}

function getReturnPath(value: string | null): string {
  return value?.startsWith("/oauth/authorize?") ? value : "/dashboard";
}

function getSignupHref(returnTo: string | null): string {
  return returnTo ? `/signup?returnTo=${encodeURIComponent(returnTo)}` : "/signup";
}
