import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import type { Expertise, OperatorProfile } from "../types";

const STORAGE_KEY = "netra_expertise";
const DEFAULT_EXPERTISE: Expertise[] = ["DB", "Memory"];

export function loadExpertise(): Expertise[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_EXPERTISE;
    const parsed = JSON.parse(raw) as Expertise[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_EXPERTISE;
  } catch {
    return DEFAULT_EXPERTISE;
  }
}

export function saveExpertise(expertise: Expertise[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expertise));
  } catch {
    /* ignore */
  }
}

/**
 * Operator profile = real Clerk identity + a client-side expertise preference.
 * Expertise drives Jira intent-routing; the backend does not persist it.
 */
export function useOperator(): {
  operator: OperatorProfile;
  setExpertise: (e: Expertise[]) => void;
} {
  const { user } = useUser();
  const [expertise, setExpertiseState] = useState<Expertise[]>(loadExpertise);

  useEffect(() => {
    saveExpertise(expertise);
  }, [expertise]);

  const setExpertise = useCallback((e: Expertise[]) => setExpertiseState(e), []);

  const operator: OperatorProfile = {
    username:
      user?.fullName ??
      user?.username ??
      user?.primaryEmailAddress?.emailAddress?.split("@")[0] ??
      "Operator",
    email: user?.primaryEmailAddress?.emailAddress ?? "",
    expertise,
  };

  return { operator, setExpertise };
}
