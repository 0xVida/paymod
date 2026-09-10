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

const signupSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email(),
  password: z.string().min(8, "At least 8 characters"),
});

function SignupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof signupSchema>) {
    setError(null);
    try {
      await api.post("/v1/auth/signup", values);
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
          <CardTitle>Create your account</CardTitle>
          <CardDescription>
            Create your first isolated Agent Wallet. No team setup is required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input autoComplete="name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Creating account..." : "Create account"}
              </Button>
            </form>
          </Form>
          <p className="auth-switch">
            Already have an account? <Link href={getLoginHref(searchParams.get("returnTo"))}>Sign in</Link>
          </p>
        </CardContent>
      </Card>
    </AuthShell>
  );
}

export default function SignupPage() {
  return <Suspense fallback={<AuthShell><p>Preparing sign up...</p></AuthShell>}><SignupContent /></Suspense>;
}

function getReturnPath(value: string | null): string {
  return value?.startsWith("/oauth/authorize?") ? value : "/dashboard";
}

function getLoginHref(returnTo: string | null): string {
  return returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login";
}
