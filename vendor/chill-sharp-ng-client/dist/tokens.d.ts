import { InjectionToken, Provider } from "@angular/core";
import { ChillSharpClient } from "chill-sharp-ts-client";
import type { ChillSharpClientOptions } from "chill-sharp-ts-client";
export interface ChillSharpNgOptions {
    baseUrl: string;
    client?: ChillSharpClient;
    options?: ChillSharpClientOptions;
}
export declare const CHILL_SHARP_CLIENT: InjectionToken<ChillSharpClient>;
export declare function createChillSharpClient(config: ChillSharpNgOptions): ChillSharpClient;
export declare function provideChillSharpClient(config: ChillSharpNgOptions): Provider[];
