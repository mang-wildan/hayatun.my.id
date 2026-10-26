"use client";

import { apiClient } from "@/lib/api-client";

export function LogoutButton() {
  return (
    <button
      type="button"
      className="link-button"
      onClick={async () => {
        await apiClient("/api/auth/logout");
        window.location.assign("/");
      }}
    >
      Keluar
    </button>
  );
}
