const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ComponentType } = require("discord.js");
const command = require("../Commands/construtor/construtor");
const {
  BUILDER_APPLICATION_FIELDS, BUILDER_APPLICATION_IDS, buildBuilderApplicationDecisionRow,
  buildBuilderApplicationModal, buildBuilderApplicationPanel,
} = require("../utils/staff-application-components");

test("builder command exposes the five requested application questions", () => {
  const commandData = command.data.toJSON();
  const modal = buildBuilderApplicationModal().toJSON();
  assert.equal(commandData.name, "construtor");
  assert.equal(modal.components.length, 5);
  assert.deepEqual(modal.components.map((item) => item.component.type), Array(5).fill(ComponentType.TextInput));
  assert.deepEqual(modal.components.map((item) => item.label), BUILDER_APPLICATION_FIELDS.map((field) => field.label));
  assert.match(BUILDER_APPLICATION_FIELDS[2].placeholder, /Voxel/i);
  assert.match(BUILDER_APPLICATION_FIELDS[4].placeholder, /5 imagens/i);
});

test("builder panel and review controls use their own interaction IDs", () => {
  const panel = buildBuilderApplicationPanel();
  assert.equal(panel[0].components[2].accessory.custom_id, BUILDER_APPLICATION_IDS.openButton);
  const controls = buildBuilderApplicationDecisionRow("123");
  assert.deepEqual(controls.components.map((button) => button.custom_id), ["builder:approve:123", "builder:reject:123"]);
});
