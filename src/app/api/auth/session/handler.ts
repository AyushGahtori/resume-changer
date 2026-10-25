import { NextResponse } from "next/server";
import {
  AccountAccessError,
  assertSameOrigin,
  getAppMode,
  readBoundedBody,
} from "@/lib/cloud/security";
import { privateResponse } from "@/lib/cloud/protect-route";
import {
  accountFromRequest,
  sessionCookieName,
  verifyAccountToken,
} from "@/lib/cloud/server-account";

export const runtime = "nodejs";

function failure(error: unknown) {
  if (error instanceof AccountAccessError)
    return privateResponse(
      NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      ),
    );
  return privateResponse(
    NextResponse.json(
      {
        error: "Sign-in is temporarily unavailable.",
        code: "ACCOUNT_UNAVAILABLE",
      },
      { status: 503 },
    ),
  );
}

export async function POST(request: Request) {
  try {
    if (getAppMode() !== "firebase")
      return NextResponse.json(
        { error: "Cloud sign-in is not enabled." },
        { status: 404 },
      );
    assertSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new AccountAccessError(
        "Send a JSON sign-in request.",
        "INVALID_REQUEST",
        400,
      );
    const bytes = await readBoundedBody(request, 16_384);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new AccountAccessError(
        "The sign-in request is invalid.",
        "INVALID_REQUEST",
        400,
      );
    }
    const token =
      body && typeof body === "object" && "idToken" in body
        ? body.idToken
        : undefined;
    if (typeof token !== "string" || token.length > 3_800)
      throw new AccountAccessError(
        "The sign-in token is invalid.",
        "INVALID_REQUEST",
        400,
      );
    const account = await verifyAccountToken(token);
    const response = NextResponse.json({
      account: {
        uid: account.uid,
        email: account.email,
        displayName: account.displayName,
      },
    });
    response.cookies.set(sessionCookieName(), token, {
      httpOnly: true,
      secure: sessionCookieName().startsWith("__Host-"),
      sameSite: "lax",
      path: "/",
      maxAge: Math.max(
        0,
        Math.min(3600, account.expiresAt - Math.floor(Date.now() / 1000)),
      ),
    });
    return privateResponse(response);
  } catch (error) {
    return failure(error);
  }
}

export async function GET(request: Request) {
  try {
    if (getAppMode() !== "firebase")
      return NextResponse.json({ account: null });
    const account = await accountFromRequest(request);
    return privateResponse(
      NextResponse.json({
        account: {
          uid: account.uid,
          email: account.email,
          displayName: account.displayName,
        },
      }),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const response = NextResponse.json({ signedOut: true });
    for (const name of ["__Host-resume_session", "resume_session"])
      response.cookies.set(name, "", {
        path: "/",
        maxAge: 0,
        httpOnly: true,
        secure: name.startsWith("__Host-"),
        sameSite: "lax",
      });
    return privateResponse(response);
  } catch (error) {
    return failure(error);
  }
}
