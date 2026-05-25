import { config } from "dotenv";
config({ path: ".env.test" });

process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
process.env.SMS_DEV_MODE = "true";

global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};

afterEach(() => {
  jest.clearAllMocks();
});
