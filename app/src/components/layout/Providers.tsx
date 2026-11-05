"use client";
import { AppProvider } from "@/context/AppContext";
import { VoiceProvider } from "@/context/VoiceContext";
import PrivyClientProvider from "@/components/layout/PrivyClientProvider";
import { AuthProvider } from "@/components/auth/AuthProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyClientProvider>
      <AuthProvider>
        <AppProvider>
          <VoiceProvider>{children}</VoiceProvider>
        </AppProvider>
      </AuthProvider>
    </PrivyClientProvider>
  );
}
