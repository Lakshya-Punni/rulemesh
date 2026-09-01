from __future__ import annotations

import asyncio
import random
from contextlib import suppress

from .demo_stages import DEMO_STAGE_CHANGES
from .models import DemoStageName
from .models import Snapshot
from .state import live_connections, runtime


SIMULATION_TICK_SECONDS = 0.1
SIMULATION_EVENTS_PER_BATCH = 60


class SimulationController:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None

    async def start(self, seed: int) -> Snapshot:
        await self._cancel_task()
        snapshot = await runtime.set_simulation_status(True, seed)
        await live_connections.broadcast(snapshot)
        self._task = asyncio.create_task(self._run(seed), name="rulemesh-simulation")
        return snapshot

    async def stop(self) -> Snapshot:
        await self._cancel_task()
        snapshot = await runtime.set_simulation_status(False)
        await live_connections.broadcast(snapshot)
        return snapshot

    async def reset_demo(self) -> Snapshot:
        await self._cancel_task()
        snapshot = await runtime.reset_demo()
        await live_connections.broadcast(snapshot)
        return snapshot

    async def apply_demo_stage(self, stage: DemoStageName) -> Snapshot:
        await self._cancel_task()
        snapshot = await runtime.apply_demo_stage(DEMO_STAGE_CHANGES[stage])
        await live_connections.broadcast(snapshot)
        return snapshot

    async def _cancel_task(self) -> None:
        task = self._task
        self._task = None
        if task is None or task.done():
            return
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    async def _run(self, seed: int) -> None:
        random_source = random.Random(seed)
        incident_tick = 18 + random_source.randrange(12)
        tick = 0
        loop = asyncio.get_running_loop()
        next_tick_at = loop.time()
        try:
            while True:
                tick += 1
                events = []
                for event_index in range(SIMULATION_EVENTS_PER_BATCH):
                    phase = tick + event_index / SIMULATION_EVENTS_PER_BATCH
                    if phase < incident_tick:
                        smoke = round(random_source.random() * 8, 2)
                        temperature = round(24 + random_source.random() * 2, 2)
                    else:
                        incident_progress = phase - incident_tick
                        smoke = round(min(95, incident_progress * 6), 2)
                        temperature = round(min(45, 26 + incident_progress * 1.2), 2)

                    if event_index % 2 == 0:
                        events.append(("laboratory.smoke", smoke))
                    else:
                        events.append(("laboratory.temperature", temperature))

                snapshot = await runtime.update_environment_events(events)
                await live_connections.broadcast(snapshot)
                next_tick_at += SIMULATION_TICK_SECONDS
                await asyncio.sleep(max(0, next_tick_at - loop.time()))
        except asyncio.CancelledError:
            raise
        except Exception:
            snapshot = await runtime.set_simulation_status(False)
            await live_connections.broadcast(snapshot)
            raise


simulation = SimulationController()
