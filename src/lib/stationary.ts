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
    // 1. Ha a GPS pontosság túl rossz
    if (newPos.accuracy > this.options.maxAcceptableAccuracy) {
      if (this.stationaryAnchor) {
        return { position: this.stationaryAnchor, isStationary: true };
      }
      const fallbackPos = this.lastValidPosition || newPos;
      return { position: fallbackPos, isStationary: false };
    }

    const speed = newPos.speed !== null ? newPos.speed : this.calculateSpeed(newPos);
    const isMoving = speed > this.options.speedThreshold;

    if (!isMoving) {
      if (!this.stationaryAnchor) {
        this.stationaryAnchor = newPos;
        this.stationarySince = Date.now();
      } else {
        const distance = this.getDistanceFromLatLonInMeters(
          this.stationaryAnchor.latitude,
          this.stationaryAnchor.longitude,
          newPos.latitude,
          newPos.longitude
        );

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
          this.stationaryAnchor = newPos;
        }
      }
    } else {
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
    const timeDiff = (newPos.timestamp - this.lastValidPosition.timestamp) / 1000;
    if (timeDiff <= 0) return 0;
    return distance / timeDiff;
  }

  private getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
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

// Kompatibilitás biztosítása a MapApp.tsx-hezesperelt updateStop függvénnyel
export function updateStop(...args: any[]): void {
  // Opcionális logika vagy üres implementáció, ha a komponens hívja
}
