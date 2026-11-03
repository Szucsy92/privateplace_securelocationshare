// src/lib/stationary.ts

export interface PositionCoordinates {
  latitude: number;
  longitude: number;
  speed: number | null;
  accuracy: number;
  timestamp: number;
}

export interface StationaryStateOptions {
  speedThreshold: number; // m/s alatt állónak tekinti (pl. 0.6 m/s ~ 2.1 km/h)
  maxAcceptableAccuracy: number; // Ennél rosszabb pontosságú pontokat szűr (pl. 25 méter)
  stationaryTimeMs?: number; // Opcionális: mennyi ideig kell a küszöb alatt lenni
}

export class StationaryDetector {
  private lastValidPosition: PositionCoordinates | null = null;
  private stationaryAnchor: PositionCoordinates | null = null;
  private stationarySince: number | null = null;

  // Alapértelmezett beállítások
  private options: StationaryStateOptions = {
    speedThreshold: 0.6, // ~2.1 km/h alatt állónak számít
    maxAcceptableAccuracy: 25, // 25 méternél rosszabb GPS pontosság elvetése
  };

  constructor(options?: Partial<StationaryStateOptions>) {
    if (options) {
      this.options = { ...this.options, ...options };
    }
  }

  /**
   * Megvizsgálja, hogy az új pozíció alapján az eszköz áll-e,
   * és visszatér a stabilizált (vagy rögzített) koordinátával.
   */
  public processPosition(newPos: PositionCoordinates): {
    position: PositionCoordinates;
    isStationary: boolean;
  } {
    // 1. Ha a GPS pontosság túl rossz, elvetjük vagy a régivel dolgozunk
    if (newPos.accuracy > this.options.maxAcceptableAccuracy) {
      if (this.stationaryAnchor) {
        return { position: this.stationaryAnchor, isStationary: true };
      }
    }

    const speed = newPos.speed !== null ? newPos.speed : this.calculateSpeed(newPos);
    const isMoving = speed > this.options.speedThreshold;

    if (!isMoving) {
      // Ha állítólag áll
      if (!this.stationaryAnchor) {
        // Első stabil pont rögzítése álló helyzetben
        this.stationaryAnchor = newPos;
        this.stationarySince = Date.now();
      } else {
        // Ha már állt, ellenőrizzük, milyen messze van a rögzített horgonytól
        const distance = this.getDistanceFromLatLonInMeters(
          this.stationaryAnchor.latitude,
          this.stationaryAnchor.longitude,
          newPos.latitude,
          newPos.longitude
        );

        // Ha 4-5 méteren belül ugrál a GPS álló helyzetben, akkor RÖGZÍTJÜK a horgonyponton!
        if (distance < 5.0) {
          return {
            position: {
              ...this.stationaryAnchor,
              timestamp: newPos.timestamp,
              accuracy: newPos.accuracy,
            },
            isStationary: true,
          };
        } else {
          // Ha ennél nagyobb a távolság, az valós elmozdulás lehet
          this.stationaryAnchor = newPos;
        }
      }
    } else {
      // Mozgás közben feloldjuk a horgonyt, hagyjuk érvényesülni a valós pozíciót
      this.stationaryAnchor = null;
      this.stationarySince = null;
    }

    this.lastValidPosition = newPos;
    return { position: newPos, isStationary: false };
  }

  private calculateSpeed(newPos: PositionCoordinates): number {
    if (!this.lastValidPosition) return 0;
    const distance = this.getDistanceFromLatLonInMeters(
      this.lastValidPosition.latitude,
      this.lastValidPosition.longitude,
      newPos.latitude,
      newPos.longitude
    );
    const timeDiff = (newPos.timestamp - this.lastValidPosition.timestamp) / 1000; // másodperc
    if (timeDiff <= 0) return 0;
    return distance / timeDiff;
  }

  private getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Föld sugara méterben
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}

export const stationaryDetector = new StationaryDetector();
