using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SyriAI.Backend.DataAccess.Migrations.Studio
{
    /// <inheritdoc />
    public partial class MediaChunks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MediaChunks",
                columns: table => new
                {
                    MediaId = table.Column<Guid>(type: "char(36)", nullable: false),
                    Index = table.Column<int>(type: "int", nullable: false),
                    Data = table.Column<byte[]>(type: "longblob", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MediaChunks", x => new { x.MediaId, x.Index });
                })
                .Annotation("MySql:CharSet", "utf8mb4");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MediaChunks");
        }
    }
}
