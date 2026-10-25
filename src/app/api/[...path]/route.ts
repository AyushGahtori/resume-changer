import { dispatchApiRequest, optionsForApiRequest } from "@/lib/api/dispatch";

export const runtime = "nodejs";
export const maxDuration = 300;

export const GET = dispatchApiRequest;
export const POST = dispatchApiRequest;
export const PUT = dispatchApiRequest;
export const PATCH = dispatchApiRequest;
export const DELETE = dispatchApiRequest;
export const HEAD = dispatchApiRequest;
export const OPTIONS = optionsForApiRequest;
