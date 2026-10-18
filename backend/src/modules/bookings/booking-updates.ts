import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type Redis from 'ioredis';
import { InjectRedis } from '../../common/redis/redis.module';

const PATTERN = 'booking:*';
const channel = (bookingId: string) => `booking:${bookingId}`;

/**
 * "Booking X changed" signals for live streams. With Redis up, signals go through Redis pub/sub so every API
 * instance hears them; otherwise (tests, Redis outage) they stay in this process. Streams reload the booking on each
 * signal, so a signal carries no data and a lost one only delays the next update (the app also polls as fallback).
 */
@Injectable()
export class BookingUpdates implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(BookingUpdates.name);
  private readonly local = new EventEmitter().setMaxListeners(0);
  private sub: Redis | null = null;

  constructor(@InjectRedis() private readonly redis: Redis | null) {}

  onModuleInit(): void {
    if (!this.redis) return;
    const sub = this.redis.duplicate();
    sub.on('error', () => undefined); // the main client already reports Redis outages
    sub.on('ready', () => void sub.psubscribe(PATTERN).catch(() => undefined));
    sub.on('pmessage', (_pattern: string, ch: string) => this.local.emit(ch));
    sub.connect().catch(() => undefined);
    this.sub = sub;
  }

  onModuleDestroy(): void {
    this.sub?.disconnect();
  }

  /** Call after the change is committed. Never throws. */
  publish(bookingId: string): void {
    const ch = channel(bookingId);
    if (this.redis?.status === 'ready' && this.sub?.status === 'ready') {
      this.redis.publish(ch, '1').catch((err: Error) => {
        this.log.warn(`publish failed (${err.message}); delivering locally only`);
        this.local.emit(ch);
      });
    } else {
      this.local.emit(ch);
    }
  }

  /** Returns the unsubscribe function. */
  subscribe(bookingId: string, onChange: () => void): () => void {
    const ch = channel(bookingId);
    this.local.on(ch, onChange);
    return () => this.local.off(ch, onChange);
  }
}
