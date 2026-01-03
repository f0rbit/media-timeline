/// <reference types="@cloudflare/workers-types" />

// Thin entry point that re-exports from @media/server package
export { createUnifiedApp, handleScheduled, type UnifiedApp } from "@media/server";
