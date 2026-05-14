import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  isSystemAdmin,
  hasPermission,
  PERMISSIONS,
} from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session || !hasPermission(session, PERMISSIONS.USER_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    // Get roles from database
    const roles = await prisma.role.findMany({
      where: !isSystemAdmin(session) ? { isSystem: false } : undefined,
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { users: true },
        },
      },
    });

    return NextResponse.json(
      roles.map((role) => ({
        id: role.id,
        name: role.name,
        displayName: role.displayName,
        description: role.description,
        isSystem: role.isSystem,
        userCount: role._count.users,
      })),
    );
  } catch (error) {
    console.error("Error fetching roles:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_LOAD_ROLES" },
      { status: 500 },
    );
  }
}
