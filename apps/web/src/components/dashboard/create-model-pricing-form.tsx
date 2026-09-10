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
type FormValues = {
  provider: Provider | "";
  model: string;
  inputTokenPriceAtomic: string;
  cachedInputTokenPriceAtomic: string;
  outputTokenPriceAtomic: string;
  markupBasisPoints: string;
};

/**
 * prices are atomic USDC units (1,000,000 = $1) per 1,000,000 tokens, not
 * per token, matching `usage-pricing.ts`. submitting always adds a new
 * version and closes out the prior open-ended row for the same
 * provider+model - this form never edits a past version in place.
 */
export function CreateModelPricingForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setValue, formState, reset } = useForm<FormValues>({
    defaultValues: { provider: "", model: "", inputTokenPriceAtomic: "", cachedInputTokenPriceAtomic: "", outputTokenPriceAtomic: "", markupBasisPoints: "0" },
  });
  const provider = watch("provider");

  async function onSubmit(values: FormValues) {
    setError(null);
    if (!values.provider) return;
    try {
      await api.post("/v1/admin/model-pricing", {
        provider: values.provider,
        model: values.model,
        inputTokenPriceAtomic: values.inputTokenPriceAtomic,
        ...(values.cachedInputTokenPriceAtomic && { cachedInputTokenPriceAtomic: values.cachedInputTokenPriceAtomic }),
        outputTokenPriceAtomic: values.outputTokenPriceAtomic,
        markupBasisPoints: Number(values.markupBasisPoints || "0"),
      });
      reset({ provider: values.provider, model: "", inputTokenPriceAtomic: "", cachedInputTokenPriceAtomic: "", outputTokenPriceAtomic: "", markupBasisPoints: "0" });
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          <Label>Model id</Label>
          <Input placeholder="gpt-4o" {...register("model", { required: "Enter the exact model id" })} />
        </div>

        <div className="space-y-2">
          <Label>Markup (basis points)</Label>
          <Input inputMode="numeric" placeholder="0" {...register("markupBasisPoints")} />
        </div>

        <div className="space-y-2">
          <Label>Input price (atomic / 1M tokens)</Label>
          <Input inputMode="numeric" placeholder="2500000" {...register("inputTokenPriceAtomic", { required: "Enter an input price" })} />
        </div>

        <div className="space-y-2">
          <Label>Cached input price (optional)</Label>
          <Input inputMode="numeric" placeholder="1250000" {...register("cachedInputTokenPriceAtomic")} />
        </div>

        <div className="space-y-2">
          <Label>Output price (atomic / 1M tokens)</Label>
          <Input inputMode="numeric" placeholder="10000000" {...register("outputTokenPriceAtomic", { required: "Enter an output price" })} />
        </div>
      </div>

      <Button type="submit" disabled={formState.isSubmitting || !provider}>
        {formState.isSubmitting ? "Saving..." : "Add pricing version"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {formState.errors.model && <p className="text-xs text-destructive">{formState.errors.model.message}</p>}
      {formState.errors.inputTokenPriceAtomic && <p className="text-xs text-destructive">{formState.errors.inputTokenPriceAtomic.message}</p>}
      {formState.errors.outputTokenPriceAtomic && <p className="text-xs text-destructive">{formState.errors.outputTokenPriceAtomic.message}</p>}
    </form>
  );
}
