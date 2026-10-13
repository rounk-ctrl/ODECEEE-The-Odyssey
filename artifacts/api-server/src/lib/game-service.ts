import { randomInt } from "node:crypto";
import type { Prisma, Team } from "@prisma/client";
import {
  GetAdminOverviewResponse,
  GetGameSettingsResponse,
} from "@workspace/api-zod";
import { GAME } from "./constants";
import { prisma } from "./prisma";

export async function getEventState() {
  const event = await prisma.eventState.upsert({
    where: { id: "global" },
    create: { id: "global" },
    update: {},
  });
  return { status: event.status, currentRound: event.currentRound };
}

export async function getEventStatus() {
  return (await getEventState()).status;
}

export async function getSettings() {
  const settings = await prisma.gameSettings.upsert({
    where: { id: "global" },
    create: {
      id: "global",
      defaultRadiusM: GAME.defaultRadiusM,
      accuracySlackM: GAME.defaultAccuracySlackM,
      maxAccuracyM: GAME.defaultMaxAccuracyM,
    },
    update: {},
  });
  return GetGameSettingsResponse.parse({
    defaultRadiusM: settings.defaultRadiusM,
    accuracySlackM: settings.accuracySlackM,
    maxAccuracyM: settings.maxAccuracyM,
  });
}

export async function loadAdminTeam(teamId: string, currentRound?: number) {
  const round = currentRound ?? (await getEventState()).currentRound;
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      routes: {
        where: { round },
        include: { checkpoint: true },
        orderBy: { orderIndex: "asc" },
      },
      completions: {
        include: { checkpoint: true },
        orderBy: [{ round: "asc" }, { completedAt: "asc" }],
      },
      rounds: { where: { round } },
    },
  });
  if (!team) return null;

  const currentRoute = team.routes.find(
    (route) => route.orderIndex === team.currentIndex,
  );

  return {
    id: team.id,
    name: team.name,
    members: team.members,
    codeHint: team.codeHint,
    leaderName: team.leaderName,
    claimedAt: team.claimedAt,
    lastLoginAt: team.lastLoginAt,
    userAgent: team.userAgent,
    status: team.status,
    startedAt: team.rounds[0]?.startedAt ?? team.startedAt,
    finishedAt: team.rounds[0]?.finishedAt ?? team.finishedAt,
    currentIndex: team.currentIndex,
    totalCheckpoints: team.routes.length,
    currentCheckpoint: currentRoute?.checkpoint.isActive
      ? currentRoute.checkpoint.name
      : null,
    flowState: team.flowState,
    checkpointArrivedAt: team.checkpointArrivedAt,
    lastAnswerCorrect: team.lastAnswerCorrect,
    lastLat: team.lastLat,
    lastLng: team.lastLng,
    lastAccuracy: team.lastAccuracy,
    lastSeenAt: team.lastSeenAt,
    suspicious: team.suspicious,
    qualifiedForRoundTwo: team.qualifiedForRoundTwo,
    completionCount: team.completions.filter((completion) => completion.round === round).length,
    assignedRoute: team.routes.map((route) => ({
      checkpointId: route.checkpointId,
      checkpointName: route.checkpoint.name,
      orderIndex: route.orderIndex,
      round: route.round,
      lat: route.checkpoint.lat,
      lng: route.checkpoint.lng,
      radiusM: route.checkpoint.radiusM,
      isActive: route.checkpoint.isActive,
      isFinalStop: route.checkpoint.isFinalStop,
      isDetour: route.checkpoint.isDetour,
      questionText: route.checkpoint.questionText,
    })),
    completions: team.completions.map((completion) => ({
      id: completion.id,
      checkpointId: completion.checkpointId,
      checkpointName: completion.checkpoint.name,
      round: completion.round,
      completedAt: completion.completedAt,
      distanceAtCaptureM: completion.distanceAtCaptureM,
      accuracyM: completion.accuracyM,
      verificationMethod: completion.verificationMethod,
    })),
  };
}

export async function loadAdminTeams(currentRound?: number) {
  const round = currentRound ?? (await getEventState()).currentRound;
  const teams = await prisma.team.findMany({
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  const detailed = await Promise.all(
    teams.map(({ id }) => loadAdminTeam(id, round)),
  );
  return detailed.filter((team) => team !== null);
}

export async function loadAdminOverview() {
  const { status: eventStatus, currentRound } = await getEventState();
  const [teamData, checkpointCount, completionCount, recent] = await Promise.all([
    loadAdminTeams(currentRound),
    prisma.checkpoint.count({ where: { isActive: true } }),
    prisma.completion.count({ where: { round: currentRound } }),
    prisma.completion.findMany({
      where: { round: currentRound },
      take: 12,
      orderBy: { completedAt: "desc" },
      include: { team: true, checkpoint: true },
    }),
  ]);

  const now = Date.now();
  const activeRoundTeams =
    currentRound === 2
      ? teamData.filter((team) => team.qualifiedForRoundTwo)
      : teamData;
  const leaderboard = [...activeRoundTeams].sort((a, b) => {
    if (a.currentIndex !== b.currentIndex) return b.currentIndex - a.currentIndex;
    if (a.status === "FINISHED" && b.status === "FINISHED") {
      return (
        (a.finishedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (b.finishedAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
      );
    }
    return (
      (a.startedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (b.startedAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
    );
  });

  return GetAdminOverviewResponse.parse({
    eventStatus,
    currentRound,
    teamCount: teamData.length,
    activeCount: activeRoundTeams.filter((team) => team.status === "ACTIVE").length,
    finishedCount: activeRoundTeams.filter((team) => team.status === "FINISHED").length,
    stalledCount: teamData.filter(
      (team) =>
        (currentRound === 1 || team.qualifiedForRoundTwo) &&
        team.status === "ACTIVE" &&
        (!team.lastSeenAt || now - team.lastSeenAt.getTime() > 90_000),
    ).length,
    checkpointCount,
    completionCount,
    leaderboard,
    recentCompletions: recent.map((completion) => ({
      teamName: completion.team.name,
      checkpointName: completion.checkpoint.name,
      completedAt: completion.completedAt,
    })),
  });
}

function shuffled<T>(input: T[]): T[] {
  const output = [...input];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

async function createTeamRoute(
  transaction: Prisma.TransactionClient,
  teamId: string,
  round: number,
) {
  const existing = await transaction.teamRoute.findMany({
    where: { teamId, round },
    orderBy: { orderIndex: "asc" },
  });
  if (existing.length) return;

  const checkpoints = await transaction.checkpoint.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  const finalStops = checkpoints.filter((checkpoint) => checkpoint.isFinalStop);
  const randomStops = checkpoints.filter((checkpoint) => !checkpoint.isFinalStop);
  if (finalStops.length !== 2 || randomStops.length === 0) {
    throw new Error("Select exactly two active final stops and at least one active POI before starting a round.");
  }

  const otherRoutes = await transaction.teamRoute.findMany({
    where: { teamId: { not: teamId }, round },
    orderBy: { orderIndex: "asc" },
  });
  const firstCounts = new Map(randomStops.map((checkpoint) => [checkpoint.id, 0]));
  for (const route of otherRoutes) {
    if (route.orderIndex === 0 && firstCounts.has(route.checkpointId)) {
      firstCounts.set(route.checkpointId, (firstCounts.get(route.checkpointId) ?? 0) + 1);
    }
  }
  const routeGroups = new Map<string, string[]>();
  for (const route of otherRoutes) {
    const group = routeGroups.get(route.teamId) ?? [];
    group.push(route.checkpointId);
    routeGroups.set(route.teamId, group);
  }
  const otherOrders = [...routeGroups.values()].map((route) =>
    route.join("|"),
  );

  const leastUsedCount = Math.min(...firstCounts.values());
  const firstOptions = randomStops.filter(
    (checkpoint) => firstCounts.get(checkpoint.id) === leastUsedCount,
  );
  const first = firstOptions[randomInt(firstOptions.length)];
  const remaining = randomStops.filter((checkpoint) => checkpoint.id !== first.id);
  const orderedFinalStops = finalStops.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  let order = [first, ...shuffled(remaining), ...orderedFinalStops];
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const candidate = [first, ...shuffled(remaining), ...orderedFinalStops];
    const uniqueOrder = !otherOrders.includes(
      candidate.map((checkpoint) => checkpoint.id).join("|"),
    );
    order = candidate;
    if (uniqueOrder) break;
  }

  await transaction.teamRoute.createMany({
    data: order.map((checkpoint, orderIndex) => ({
      teamId,
      checkpointId: checkpoint.id,
      orderIndex,
      round,
    })),
  });
  await transaction.teamRound.upsert({
    where: { teamId_round: { teamId, round } },
    create: { teamId, round },
    update: {},
  });
}

export async function assignRoutesForRegisteredTeams(round = 1) {
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(734921601)`;
    const teams = await transaction.team.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const checkpoints = await transaction.checkpoint.findMany({
      where: { isActive: true },
      select: { isFinalStop: true },
    });
    if (
      checkpoints.filter((checkpoint) => checkpoint.isFinalStop).length !== 2 ||
      checkpoints.filter((checkpoint) => !checkpoint.isFinalStop).length === 0
    ) {
      throw new Error("Select exactly two active final stops and at least one active POI before starting a round.");
    }
    for (const team of shuffled(teams)) {
      await createTeamRoute(transaction, team.id, round);
    }
  });
}

export async function startRoundTwo() {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(734921601)`;
    const event = await transaction.eventState.findUnique({ where: { id: "global" } });
    if (event?.status !== "ENDED" || event.currentRound !== 1) {
      throw new Error("End Round 1 before opening Round 2.");
    }
    const selectedTeams = await transaction.team.findMany({
      where: { qualifiedForRoundTwo: true },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (!selectedTeams.length) {
      throw new Error("Select at least one Round 2 team in the team manager first.");
    }
    for (const { id } of selectedTeams) {
      await createTeamRoute(transaction, id, 2);
    }
    await transaction.team.updateMany({
      where: { qualifiedForRoundTwo: true },
      data: {
        status: "NOT_STARTED",
        currentIndex: 0,
        startedAt: null,
        finishedAt: null,
        lastLat: null,
        lastLng: null,
        lastAccuracy: null,
        lastSeenAt: null,
      },
    });
    return transaction.eventState.upsert({
      where: { id: "global" },
      create: {
        id: "global",
        status: "ACTIVE",
        currentRound: 2,
        startedAt: new Date(),
      },
      update: {
        status: "ACTIVE",
        currentRound: 2,
        startedAt: new Date(),
        endedAt: null,
      },
    });
  });
}

export async function startTeamVoyage(teamId: string) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(734921601)`;
    const event = await transaction.eventState.findUnique({ where: { id: "global" } });
    const round = event?.currentRound ?? 1;
    if (event?.status !== "ACTIVE") {
      throw new Error("The volunteers have not opened this round yet.");
    }
    if (round === 2) {
      const qualified = await transaction.team.findUnique({
        where: { id: teamId },
        select: { qualifiedForRoundTwo: true },
      });
      if (!qualified?.qualifiedForRoundTwo) {
        throw new Error("This team was not selected for Round 2.");
      }
    }
    await createTeamRoute(transaction, teamId, round);
    const currentTeam = await transaction.team.findUnique({
      where: { id: teamId },
    });
    if (!currentTeam) throw new Error("Team not found.");
    if (currentTeam.status === "FINISHED") return currentTeam;
    const team = await transaction.team.update({
      where: { id: teamId },
      data: {
        status: "ACTIVE",
        ...(currentTeam.startedAt ? {} : { startedAt: new Date() }),
      },
    });
    const roundStartedAt = currentTeam.startedAt ?? team.startedAt;
    await transaction.teamRound.upsert({
      where: { teamId_round: { teamId, round } },
      create: { teamId, round, startedAt: roundStartedAt },
      update: currentTeam.startedAt ? {} : { startedAt: roundStartedAt },
    });
    return team;
  });
}

export async function advancePastInactiveCheckpoints(
  teamId: string,
  currentRound?: number,
) {
  return prisma.$transaction(async (transaction) => {
    const event = await transaction.eventState.findUnique({ where: { id: "global" } });
    const round = currentRound ?? event?.currentRound ?? 1;
    const team = await transaction.team.findUnique({
      where: { id: teamId },
      include: {
        routes: {
          where: { round },
          include: { checkpoint: true },
          orderBy: { orderIndex: "asc" },
        },
      },
    });
    if (!team) return null;

    let index = team.currentIndex;
    while (
      index < team.routes.length &&
      !team.routes[index]?.checkpoint.isActive
    ) {
      index += 1;
    }

    const finished = index >= team.routes.length;
    if (index !== team.currentIndex || (finished && team.status !== "FINISHED")) {
      const finishedAt = finished ? new Date() : team.finishedAt;
      await transaction.team.update({
        where: { id: teamId },
        data: {
          currentIndex: index,
          status: finished ? "FINISHED" : team.status,
          finishedAt,
        },
      });
      if (finished) {
        await transaction.teamRound.update({
          where: { teamId_round: { teamId, round } },
          data: { finishedAt: finishedAt ?? new Date() },
        });
      }
    }
    return { currentIndex: index, total: team.routes.length, finished };
  });
}

export function teamGameSummary(
  team: Team,
  totalCheckpoints: number,
  roundTiming?: { startedAt: Date | null; finishedAt: Date | null },
) {
  return {
    id: team.id,
    name: team.name,
    status: team.status,
    startedAt: roundTiming?.startedAt ?? team.startedAt,
    finishedAt: roundTiming?.finishedAt ?? team.finishedAt,
    currentIndex: team.currentIndex,
    totalCheckpoints,
    qualifiedForRoundTwo: team.qualifiedForRoundTwo,
  };
}

export async function getTeamGameState(teamId: string) {
  const { status: eventStatus, currentRound } = await getEventState();
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      routes: {
        where: { round: currentRound },
        include: { checkpoint: true },
        orderBy: { orderIndex: "asc" },
      },
      completions: {
        include: { checkpoint: true },
        orderBy: [{ round: "asc" }, { completedAt: "asc" }],
      },
      rounds: { where: { round: currentRound } },
    },
  });
  if (!team) return null;
  const eligible = currentRound === 1 || team.qualifiedForRoundTwo;

  const activeRoute =
    eligible && eventStatus === "ACTIVE" && team.status !== "FINISHED"
      ? team.routes.find(
          (route) =>
            route.orderIndex === team.currentIndex && route.checkpoint.isActive,
        )
      : undefined;

  return {
    eventStatus,
    currentRound,
    team: teamGameSummary(
      team,
      team.routes.length,
      team.rounds[0] ?? { startedAt: team.startedAt, finishedAt: team.finishedAt },
    ),
    currentCheckpoint: activeRoute
      ? {
          id: activeRoute.checkpoint.id,
          name: activeRoute.checkpoint.name,
          lat: activeRoute.checkpoint.lat,
          lng: activeRoute.checkpoint.lng,
          radiusM: activeRoute.checkpoint.radiusM,
          hint: activeRoute.checkpoint.hint,
        }
      : null,
    progress: team.currentIndex,
    total: team.routes.length,
    completions: team.completions.map((completion) => ({
      id: completion.id,
      checkpointId: completion.checkpointId,
      checkpointName: completion.checkpoint.name,
      completedAt: completion.completedAt,
      distanceAtCaptureM: completion.distanceAtCaptureM,
      accuracyM: completion.accuracyM,
      round: completion.round,
    })),
  };
}

export async function createProvisioningPasscode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += alphabet[randomInt(alphabet.length)];
  }
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

export async function createPasscodeHash(passcode: string) {
  const bcrypt = await import("bcrypt");
  return bcrypt.default.hash(passcode, 12);
}
