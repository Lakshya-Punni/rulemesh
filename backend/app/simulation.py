from __future__ import annotations

import asyncio
import random
from contextlib import suppress

from .models import Snapshot
from .state import live_connections, runtime


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
        try:
            while True:
                tick += 1
                if tick < incident_tick:
                    smoke = round(random_source.random() * 8)
                    temperature = 24 + random_source.random() * 2
                else:
                    smoke = min(95, (tick - incident_tick) * 6)
                    temperature = min(45, 26 + (tick - incident_tick) * 1.2)

                snapshot = await runtime.update_environment(
                    {
                        "laboratory.smoke": smoke,
                        "laboratory.temperature": temperature,
                    }
                )
                await live_connections.broadcast(snapshot)
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            raise
        except Exception:
            snapshot = await runtime.set_simulation_status(False)
            await live_connections.broadcast(snapshot)
            raise


simulation = SimulationController()
