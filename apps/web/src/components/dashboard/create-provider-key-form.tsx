"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, describeError } from "@/lib/api";

type Provider = "OPENAI" | "ANTHROPIC";
type FormValues = { provider: Provider | ""; label: string; key: string };

/** the raw key is only ever sent once, on creation - `AdminController.createProviderKey` never returns it again, same "shown once" discipline as `RevealCredentialButton`. */
export function CreateProviderKeyForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setValue, formState, reset } = useForm<FormValues>({
    defaultValues: { provider: "", label: "", key: "" },
  });
  const provider = watch("provider");

  async function onSubmit(values: FormValues) {
    setError(null);
    if (!values.provider) return;
    try {
      await api.post("/v1/admin/provider-keys", { provider: values.provider, label: values.label, key: values.key });
      reset();
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] lg:items-end">
        <div className="space-y-2">
          <Label>Provider</Label>
          <Select value={provider} onValueChange={(value) => setValue("provider", value as Provider)}>
            <SelectTrigger className="h-[2.65rem] w-full">
              <SelectValue placeholder="Choose a provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OPENAI">OpenAI</SelectItem>
              <SelectItem value="ANTHROPIC">Anthropic</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Label</Label>
          <Input placeholder="Production key" {...register("label", { required: "Enter a label" })} />
        </div>

        <div className="space-y-2">
          <Label>API key</Label>
          <Input type="password" placeholder="sk-..." {...register("key", { required: "Enter the real provider key" })} />
        </div>

        <Button className="h-[2.65rem] lg:min-w-32" type="submit" disabled={formState.isSubmitting || !provider}>
          {formState.isSubmitting ? "Adding..." : "Add key"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {formState.errors.label && <p className="text-xs text-destructive">{formState.errors.label.message}</p>}
      {formState.errors.key && <p className="text-xs text-destructive">{formState.errors.key.message}</p>}
    </form>
  );
}
