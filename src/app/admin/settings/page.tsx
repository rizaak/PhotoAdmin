import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { listWatermarks } from "@/server/watermarks";
import type { SlotState } from "./watermark-editor";
import { WatermarkSection } from "./watermark-section";

export default async function SettingsPage() {
  const studio = await requireStudio();
  const t = await getTranslations("settings");
  const tw = await getTranslations("settings.watermarks");
  const marks = await listWatermarks(db, studio.id);

  const initial: SlotState[] = marks.map((w) => ({
    slot: w.slot,
    type: w.type,
    text: w.text ?? "",
    imageKey: w.imageKey,
    opacityPct: w.opacityPct,
    sizePct: w.sizePct,
    placement: w.placement,
    saved: true,
  }));

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <section>
        <h2 className="mb-4 font-medium">{tw("title")}</h2>
        <WatermarkSection
          initial={initial}
          labels={{
            intro: tw("intro"), regenNote: tw("regenNote"), add: tw("add"),
            slot: tw.raw("slot") as string, typeText: tw("typeText"), typeImage: tw("typeImage"),
            textPlaceholder: tw("textPlaceholder"), uploadPng: tw("uploadPng"), uploading: tw("uploading"),
            replacePng: tw("replacePng"), invalidPng: tw("invalidPng"),
            opacity: tw("opacity"), size: tw("size"), position: tw("position"), tile: tw("tile"),
            save: tw("save"), delete: tw("delete"), saved: tw("saved"),
            incomplete: tw("incomplete"), error: tw("error"),
          }}
          previewLabels={{
            preview: tw("preview"), previewLoading: tw("previewLoading"), previewError: tw("previewError"),
            previewPick: tw("previewPick"),
          }}
        />
      </section>
    </div>
  );
}
