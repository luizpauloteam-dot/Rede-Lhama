const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ComponentType } = require("discord.js");
const command = require("../Commands/staff/staff");
const { APPLICATION_FIELDS, STAFF_APPLICATION_IDS, buildStaffApplicationDecisionRow, buildStaffApplicationEmbed, buildStaffApplicationModal, buildStaffApplicationPanel } = require("../utils/staff-application-components");

test("staff command exposes a five-question application with original wording", () => {
  const commandData = command.data.toJSON();
  assert.equal(commandData.name, "staff");
  assert.equal(commandData.options[0].name, "painel");
  const modal = buildStaffApplicationModal().toJSON();
  assert.equal(modal.components.length, 5);
  assert.deepEqual(modal.components.map((item) => item.component.type), Array(5).fill(ComponentType.TextInput));
  assert.deepEqual(modal.components.map((item) => item.label), APPLICATION_FIELDS.map((field) => field.label));
  assert.match(APPLICATION_FIELDS[0].placeholder, /rotina/i);
  assert.match(APPLICATION_FIELDS[4].placeholder, /acrescentar/i);
});

test("staff panel uses a button that opens the application", () => {
  const panel = buildStaffApplicationPanel();
  const button = panel[0].components[2].accessory;
  assert.equal(button.custom_id, STAFF_APPLICATION_IDS.openButton);
  assert.equal(button.label, "Candidatar-se à Staff");
});

test("application embed identifies the candidate and carries every answer", () => {
  const answers = APPLICATION_FIELDS.map(({ label }) => ({ label, value: "Resposta de teste" }));
  const embed = buildStaffApplicationEmbed({
    applicant: { id: "123", toString: () => "<@123>", displayAvatarURL: () => "https://example.com/avatar.png" },
    answers,
  }).toJSON();
  assert.match(embed.description, /123/);
  assert.equal(embed.fields.length, 5);
});

test("application review controls include approve and reject actions for the candidate", () => {
  const controls = buildStaffApplicationDecisionRow("123");
  assert.deepEqual(controls.components.map((button) => button.custom_id), ["staff:approve:123", "staff:reject:123"]);
});
