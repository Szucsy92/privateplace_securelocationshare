// src/lib/stationary.ts

export interface PositionCoordinates {
  latitude: number;
  longitude: number;
  speed: number | null;
  accuracy: number;
  timestamp: number;
}

export interface StationaryStateOptions {
  speedThreshold: number;
  maxAcceptableAccuracy: number;
  stationaryTimeMs?: number;
}

export class StationaryDetector {
  private lastValidPosition: PositionCoordinates | null = null;
  private stationaryAnchor: PositionCoordinates | null = null;
  private stationarySince: number | null = null;

  private options: StationaryStateOptions = {
    speedThreshold: 0.6,
    maxAcceptableAccuracy: 25,
  };

  constructor(options?: Partial<StationaryStateOptions>) {
    if (options) {
      this.options = { ...this.options, ...options };
    }
  }

  public processPosition(newPos: PositionCoordinates): {
    position: PositionCoordinates;
    isStationary: boolean;
  } {
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

// Eredeti projekt által elvárt segédfüggvények implementációja
let currentStopInfo: { startTime: number; latitude: number; longitude: number } | null = null;

export function updateStop(position: PositionCoordinates, isStationary: boolean): void {
  if (isStationary) {
    if (!currentStopInfo) {
      currentStopInfo = {
        startTime: Date.now(),
        latitude: position.latitude,
        longitude: position.longitude,
      };
    }
  } else {
    currentStopInfo = null;
  }
}

export function stopLabel(): string {
  if (!currentStopInfo) return "";
  const durationMinutes = Math.floor((Date.now() - currentStopInfo.startTime) / 60000);
  if (durationMinutes < 1) return "Nemrég állt meg";
  return `Áll: ${durationMinutes} perce`;
}
