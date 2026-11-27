import { describe, expect, test } from "bun:test"
import { isLocalDatabase, secureConnection } from "./tls"

describe("secureConnection", () => {
  test("dials a local database without TLS", () => {
    expect(secureConnection("postgresql://csk_hub:csk_hub@localhost:5433/csk_hub")).toEqual({
      connectionString: "postgresql://csk_hub:csk_hub@localhost:5433/csk_hub"
    })
  })

  test("verifies a remote database against the committed CA, whatever sslmode asks for", () => {
    const { connectionString, ssl } = secureConnection("postgresql://u:p@db.example.com:5432/csk?sslmode=require")
    expect(connectionString).toBe("postgresql://u:p@db.example.com:5432/csk")
    expect(ssl?.rejectUnauthorized).toBe(true)
    expect(ssl?.ca).toContain("BEGIN CERTIFICATE")
  })

  test("dials a private-network database in plain text only when the URL says sslmode=disable", () => {
    expect(secureConnection("postgresql://csk_hub:secret@db:5432/csk_hub?sslmode=disable")).toEqual({
      connectionString: "postgresql://csk_hub:secret@db:5432/csk_hub"
    })
  })

  test("a disabled sslmode does not make a database local", () => {
    expect(isLocalDatabase("postgresql://csk_hub:secret@db:5432/csk_hub?sslmode=disable")).toBe(false)
  })

  test("dials a local MariaDB without TLS", () => {
    expect(secureConnection("mariadb://csk_hub:csk_hub@localhost:3307/csk_hub")).toEqual({
      connectionString: "mariadb://csk_hub:csk_hub@localhost:3307/csk_hub"
    })
  })

  test("verifies a remote MariaDB against the system trust store, whatever sslmode asks for", () => {
    expect(secureConnection("mariadb://u:p@db.example.com:3306/csk?sslmode=require")).toEqual({
      connectionString: "mariadb://u:p@db.example.com:3306/csk",
      ssl: { rejectUnauthorized: true }
    })
  })

  test("dials a private-network MariaDB in plain text only when the URL says sslmode=disable", () => {
    expect(secureConnection("mariadb://csk_hub:secret@db:3306/csk_hub?sslmode=disable")).toEqual({
      connectionString: "mariadb://csk_hub:secret@db:3306/csk_hub"
    })
  })
})
