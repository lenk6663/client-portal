export const WebSocketServer = jest.fn().mockImplementation(() => ({
  on: jest.fn(),
  clients: new Set(),
  close: jest.fn(),
}));
export const WebSocket = jest.fn();
