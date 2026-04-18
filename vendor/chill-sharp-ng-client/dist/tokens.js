/*
 * ChillSharp is a lightweight .NET library that sits on top of Entity Framework Core
 * and turns an existing data model into a fully working REST API with almost no setup.
 * Copyright (C) 2025 Andrea Piovesan
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
import { InjectionToken } from "@angular/core";
import { ChillSharpClient } from "chill-sharp-ts-client";
export const CHILL_SHARP_CLIENT = new InjectionToken("CHILL_SHARP_CLIENT");
export function createChillSharpClient(config) {
    if (config.client) {
        return config.client;
    }
    return new ChillSharpClient(config.baseUrl, config.options);
}
export function provideChillSharpClient(config) {
    const client = createChillSharpClient(config);
    return [
        {
            provide: CHILL_SHARP_CLIENT,
            useValue: client
        }
    ];
}
