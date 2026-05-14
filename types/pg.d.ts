declare module 'pg' {
  export class Pool {
    constructor(config?: {
      connectionString?: string;
      host?: string;
      port?: number;
      database?: string;
      user?: string;
      password?: string;
      ssl?: boolean | object;
      max?: number;
      idleTimeoutMillis?: number;
      connectionTimeoutMillis?: number;
    });
    query(text: string, values?: any[]): Promise<any>;
    connect(): Promise<any>;
    end(): Promise<void>;
  }
}
