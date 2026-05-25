import jwt from "jsonwebtoken";
import { JwtPayload } from "../../src/types";

export function generateTestToken(payload: Partial<JwtPayload> = {}): string {
  const defaultPayload = {
    sub: "test-user-id",
    phone: "+79991234567",
    role: "client",
  };
  return jwt.sign({ ...defaultPayload, ...payload }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "15m" });
}
