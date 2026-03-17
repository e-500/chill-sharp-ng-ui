import { Inject, Injectable } from '@angular/core';
import { from, type Observable } from 'rxjs';
import { ChillSharpClient, type JsonObject } from 'chill-sharp-ts-client';
import { CHILL_SHARP_CLIENT } from './tokens';

@Injectable({
  providedIn: 'root'
})
export class ChillSharpNgClient {
  constructor(@Inject(CHILL_SHARP_CLIENT) private readonly client: ChillSharpClient) {}

  query(dtoQuery: JsonObject): Observable<JsonObject> {
    return from(this.client.query(dtoQuery));
  }

  find(dtoEntity: JsonObject): Observable<JsonObject | null> {
    return from(this.client.find(dtoEntity));
  }

  create(dtoEntity: JsonObject): Observable<JsonObject> {
    return from(this.client.create(dtoEntity));
  }

  update(dtoEntity: JsonObject): Observable<JsonObject> {
    return from(this.client.update(dtoEntity));
  }

  delete(dtoEntity: JsonObject): Observable<void> {
    return from(this.client.delete(dtoEntity));
  }

  chunk(operations: JsonObject[]): Observable<JsonObject[]> {
    return from(this.client.chunk(operations));
  }

  getSchema(chillType: string, chillViewCode: string, cultureName?: string): Observable<JsonObject | null> {
    return from(this.client.getSchema(chillType, chillViewCode, cultureName));
  }

  setSchema(schema: JsonObject): Observable<JsonObject | null> {
    return from(this.client.setSchema(schema));
  }

  getText(labelGuid: string, cultureName: string): Observable<JsonObject | null> {
    return from(this.client.getText(labelGuid, cultureName));
  }

  setText(payload: JsonObject): Observable<JsonObject> {
    return from(this.client.setText(payload));
  }

  registerAuthAccount(payload: JsonObject): Observable<JsonObject> {
    return from(this.client.registerAuthAccount(payload));
  }

  loginAuthAccount(payload: JsonObject): Observable<JsonObject> {
    return from(this.client.loginAuthAccount(payload));
  }

  refreshAuthAccount(): Observable<JsonObject> {
    return from(this.client.refreshAuthAccount());
  }

  changeAuthPassword(payload: JsonObject): Observable<JsonObject> {
    return from(this.client.changeAuthPassword(payload));
  }

  requestAuthPasswordReset(payload: JsonObject): Observable<JsonObject> {
    return from(this.client.requestAuthPasswordReset(payload));
  }

  resetAuthPassword(payload: JsonObject): Observable<JsonObject> {
    return from(this.client.resetAuthPassword(payload));
  }

  getRawClient(): ChillSharpClient {
    return this.client;
  }
}
