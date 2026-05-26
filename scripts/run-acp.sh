#!/bin/bash
# Wrapper script to execute the Mirepoix ACP server with dynamic GCP OAuth credentials.
# Used by editors like Zed to start the Agent Client Protocol server.

export OLLAMA_URL="https://us-central1-aiplatform.googleapis.com/v1beta1/projects/office-of-cto-491318/locations/us-central1/endpoints/openapi"
export MIREPOIX_MODEL="google/gemini-2.5-flash"
export GEMINI_API_KEY="$(gcloud auth print-access-token)"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Execute the bun script directly to preserve process lifecycle signals
exec bun "$SCRIPT_DIR/../packages/acp/src/index.ts"
