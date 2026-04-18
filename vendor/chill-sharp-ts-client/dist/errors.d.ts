export declare class ChillSharpClientError extends Error {
    readonly statusCode?: number;
    readonly responseText?: string;
    constructor(message: string, statusCode?: number, responseText?: string, cause?: unknown);
}
