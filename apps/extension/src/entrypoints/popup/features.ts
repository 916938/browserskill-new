import type { RemixiconComponentType } from "@remixicon/react";
import { RiFileList3Line, RiRecordCircleLine } from "@remixicon/react";

export type PopupFeatureId = "record" | "templates";

export type PopupView = "main" | "features" | PopupFeatureId;

export type PopupFeature = {
  id: PopupFeatureId;
  icon: RemixiconComponentType;
  titleKey: "popup.record.sectionTitle" | "popup.templates.sectionTitle";
  descKey: "popup.record.cardDesc" | "popup.templates.cardDesc";
};

export const POPUP_FEATURES: PopupFeature[] = [
  {
    id: "record",
    icon: RiRecordCircleLine,
    titleKey: "popup.record.sectionTitle",
    descKey: "popup.record.cardDesc",
  },
  {
    id: "templates",
    icon: RiFileList3Line,
    titleKey: "popup.templates.sectionTitle",
    descKey: "popup.templates.cardDesc",
  },
];
